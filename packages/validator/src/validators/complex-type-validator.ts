import type { ValidationIssue } from '../types';
import { TypeValidator } from './type-validator';
import { ValueSetValidator, type TerminologyResolutionConfig } from './valueset-validator';
import { createValidationIssue } from '../issues';
import type { StructureDefinition, ElementDefinition } from '../core/structure-definition-types';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader';
import { logger } from '../logger';
import {
    isPrimitiveType,
    getNestedValue,
    mergeElementConstraints
} from '../core/executors/structural-executor-helpers';

/**
 * Validator for complex nested types
 * Handles recursive validation of sub-elements in complex types (e.g. HumanName, Address)
 */
export class ComplexTypeValidator {
    // Lazy, shared — VSV carries its own cache, instantiating per-resource
    // wastes those caches. A singleton per ComplexTypeValidator is enough.
    private valueSetValidator: ValueSetValidator;
    private typeDefinitionCache = new Map<string, Promise<StructureDefinition | null>>();

    constructor(
        private sdLoader: StructureDefinitionLoader,
        private typeValidator?: TypeValidator
    ) {
        this.valueSetValidator = new ValueSetValidator();
    }

    configureTerminologyResolution(config: Partial<TerminologyResolutionConfig>): void {
        this.valueSetValidator.setResolutionConfig(config);
    }

    private async loadTypeDefinition(
        typeCode: string,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): Promise<StructureDefinition | null> {
        const key = `${fhirVersion}|${typeCode}`;
        let promise = this.typeDefinitionCache.get(key);
        if (!promise) {
            promise = this.sdLoader
                .loadProfile(`http://hl7.org/fhir/StructureDefinition/${typeCode}`, fhirVersion)
                .then(sd => sd?.snapshot?.element ? sd : null)
                .catch(error => {
                    logger.debug(`[ComplexTypeValidator] Could not load base StructureDefinition for ${typeCode}:`, error);
                    return null;
                });
            this.typeDefinitionCache.set(key, promise);
        }
        return promise;
    }

    /**
     * Evaluate the universal Extension constraint **ext-1** on a single
     * extension object reached via the complex-type walk.
     *
     * ext-1 (from Extension StructureDefinition):
     *   > Must have either extensions or value[x], not both.
     *
     * We detect value[x] by looking for any key that starts with `value`
     * followed by an uppercase letter — the FHIR convention for
     * polymorphic value slots (`valueString`, `valueQuantity`,
     * `valueCodeableConcept`, …). Nested extensions live under the
     * `.extension` array. Returns a single issue or null.
     */
    private checkExt1(extValue: any, basePath: string): ValidationIssue | null {
        if (!extValue || typeof extValue !== 'object') return null;

        const hasNestedExtension = Array.isArray(extValue.extension) && extValue.extension.length > 0;
        const hasValueX = Object.keys(extValue).some(k => /^value[A-Z]/.test(k));

        if (hasNestedExtension === hasValueX) {
            // Either both set (illegal) or neither set (also illegal).
            const detail = hasNestedExtension
                ? 'both child extensions AND a value[x]'
                : 'neither child extensions nor a value[x]';
            return createValidationIssue({
                code: 'profile-constraint-violation',
                path: basePath,
                resourceType: extValue.resourceType || 'Extension',
                customMessage:
                    `ext-1 violation at ${basePath}: Extension must have either ` +
                    `extensions or value[x], not both. Found ${detail}.`,
                severityOverride: 'error',
                details: {
                    constraintKey: 'ext-1',
                    hasNestedExtension,
                    hasValueX,
                },
            });
        }
        return null;
    }

    /**
     * Evaluate the **per-1** invariant on a Period value:
     *   "If present, start SHALL have a lower value than end."
     *
     * FHIR policy: comparing a partial date (e.g. `2023-06-21`) with a
     * precise dateTime (e.g. `2023-06-21T06:20:00Z`) is INDETERMINATE —
     * the implementation can't prove `start <= end`. Java's reference
     * validator treats indeterminate as fail, so we match that strictness.
     * Same-precision values go through the fast lexicographic path.
     */
    private checkPer1(period: any, basePath: string): ValidationIssue | null {
        if (!period || typeof period !== 'object') return null;
        const { start, end } = period;
        if (typeof start !== 'string' || typeof end !== 'string') return null;
        if (start.length === 0 || end.length === 0) return null;

        // Mixed precision (date vs dateTime) is FHIRPath-indeterminate;
        // Java treats indeterminate as fail — we match.
        const precisionMismatch = !start.includes('T') !== !end.includes('T');
        const isBackwards = precisionMismatch || end < start;
        if (!isBackwards) return null;

        const reason = precisionMismatch ? 'precision-mismatch' : 'backwards';
        const message = precisionMismatch
            ? `per-1 violation at ${basePath}: Period.start (${start}) and Period.end (${end}) ` +
              `have different precision — comparison is indeterminate.`
            : `per-1 violation at ${basePath}: Period.end (${end}) is before Period.start (${start}).`;

        return createValidationIssue({
            code: 'business-invalid-period-end',
            path: basePath,
            resourceType: period.resourceType || 'Period',
            customMessage: message,
            severityOverride: 'error',
            details: { constraintKey: 'per-1', start, end, reason },
        });
    }

    /**
     * Check if a path should be skipped for deep validation.
     * Certain paths contain definitions or delegated resources, not data to validate.
     */
    private shouldSkipDeepValidation(basePath: string): boolean {
        // SD snapshot/differential element definitions contain arbitrary FHIR types
        // as *definitions*, not as data to validate.
        if (basePath.match(/^StructureDefinition\.(snapshot|differential)\.element/)) {
            return true;
        }
        // Bundle.entry.resource is typed as "Resource" — entry resources must be
        // validated independently with their own SD (Phase 5), not through Bundle recursion.
        if (basePath.match(/^Bundle\.entry(\[\d+\])?\.resource/)) {
            return true;
        }
        // Parameters.parameter.resource (including nested through .part) is a
        // polymorphic Resource slot — the nested resource must be validated with
        // its own SD, not through the Parameters snapshot.
        if (basePath.match(/^Parameters\.parameter(\[\d+\])?(\.part(\[\d+\])?)*\.resource/)) {
            return true;
        }
        return false;
    }

    /**
     * Validate required sub-elements of complex types
     * This ensures that when a complex type exists (e.g., HumanName), its required sub-elements are also validated
     * Uses profile-specific constraints from the parent profile when available
     */
    async validateComplexTypeSubElements(
        value: any,
        elementDef: ElementDefinition,
        basePath: string,
        profileUrl: string,
        parentStructureDef?: StructureDefinition,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        try {
            if (!elementDef.type || elementDef.type.length === 0) return issues;

            logger.debug(`[ComplexTypeValidator] Resolving type for ${basePath} from ${elementDef.type?.map(t => t.code).join(', ')}`);
            const primaryType = await this.resolveMatchingType(value, elementDef.type, fhirVersion);
            if (!primaryType) return issues;
            if (isPrimitiveType(primaryType.code)) return issues;
            if (typeof value !== 'object' || value === null) return issues;
            if (this.shouldSkipDeepValidation(basePath)) return issues;

            // Polymorphic boundary: a path like `Observation.value[x]`
            // crossed the type resolver into a concrete type (e.g.
            // Quantity). Rewrite the path to use the concrete key
            // (`Observation.valueQuantity`) so emitted issues match
            // what a FHIR user actually reads in their resource. This
            // also keeps nested paths like `Observation.valueQuantity.
            // extension[0]` consistent without having to rewrite them
            // after the fact.
            if (basePath.endsWith('[x]')) {
                const stem = basePath.slice(0, -'[x]'.length);
                const typeSuffix = primaryType.code.charAt(0).toUpperCase() + primaryType.code.slice(1);
                basePath = stem + typeSuffix;
            }

            // Handle arrays: validate each element
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    const el = value[i];
                    if (el && typeof el === 'object' && !Array.isArray(el)) {
                        issues.push(...await this.validateComplexTypeSubElements(
                            el, elementDef, `${basePath}[${i}]`, profileUrl, parentStructureDef, fhirVersion
                        ));
                    }
                }
                return issues;
            }

            // Extension-specific invariant: ext-1 says an Extension MUST
            // have exactly one of `extension.*` or `value[x]`, never both,
            // never neither. Records' generic SDFHIRPathExecutor evaluates
            // ext-1 on extensions declared at direct resource paths, but
            // extensions nested inside complex-type children
            // (e.g. `Observation.valueQuantity.extension[0]`) never enter
            // that walk. Handle them here at the point of descent.
            if (primaryType.code === 'Extension') {
                const ext1Issue = this.checkExt1(value, basePath);
                if (ext1Issue) issues.push(ext1Issue);
            }

            // Period-specific invariant: per-1 says "If present, start
            // SHALL have a lower value than end". Nested Period instances
            // (Encounter.period, Patient.communication.period, …) live in
            // the Period SD which the generic executor doesn't reach via
            // the parent's snapshot. Handled here at the descent point.
            if (primaryType.code === 'Period') {
                const per1Issue = this.checkPer1(value, basePath);
                if (per1Issue) issues.push(per1Issue);
            }

            // Load base SD and build effective elements with profile overlays
            const effectiveElements = await this.buildEffectiveElements(
                primaryType.code, basePath, parentStructureDef, fhirVersion
            );
            if (!effectiveElements) return issues;

            // Validate each sub-element
            for (const [elementPath, subElementDef] of effectiveElements.entries()) {
                if (subElementDef.path === primaryType.code) continue;
                const subIssues = await this.validateSubElement(
                    value, elementPath, subElementDef, primaryType.code,
                    basePath, profileUrl, parentStructureDef, fhirVersion
                );
                issues.push(...subIssues);
            }
        } catch (error) {
            logger.debug(`[ComplexTypeValidator] Error validating complex type sub-elements for ${basePath}:`, error);
        }

        return issues;
    }

    /**
     * Build effective element definitions by merging base type SD with profile-specific constraints.
     */
    private async buildEffectiveElements(
        typeCode: string,
        basePath: string,
        parentStructureDef?: StructureDefinition,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): Promise<Map<string, ElementDefinition> | null> {
        const baseTypeDef = await this.loadTypeDefinition(typeCode, fhirVersion);

        if (!baseTypeDef?.snapshot?.element) {
            logger.debug(`[ComplexTypeValidator] No base StructureDefinition found for type: ${typeCode}`);
            return null;
        }

        // Extract profile-specific constraints
        const profileOverrides = this.extractProfileConstraints(typeCode, basePath, parentStructureDef);

        // Start with base type elements
        const effective = new Map<string, ElementDefinition>();
        for (const el of baseTypeDef.snapshot.element) {
            effective.set(el.path, { ...el });
        }

        // Overlay profile-specific constraints
        for (const [typePath, profileElement] of profileOverrides.entries()) {
            const base = effective.get(typePath);
            if (base) {
                effective.set(typePath, mergeElementConstraints(base, profileElement));
            } else {
                const relativePath = typePath.substring(typeCode.length + 1);
                if (!relativePath.includes('.')) {
                    effective.set(typePath, { ...profileElement, path: typePath });
                }
            }
        }

        return effective;
    }

    /**
     * Extract profile-specific constraints from the parent profile for a complex type's sub-elements.
     */
    private extractProfileConstraints(
        typeCode: string,
        basePath: string,
        parentStructureDef?: StructureDefinition
    ): Map<string, ElementDefinition> {
        const result = new Map<string, ElementDefinition>();
        if (!parentStructureDef?.snapshot?.element) return result;

        const basePathPrefix = basePath.replace(/\[\d+\]/g, '');
        for (const el of parentStructureDef.snapshot.element) {
            // Skip slice-scoped sub-elements — their cardinality / type
            // constraints apply only to the matching slice, not to every
            // occurrence at the base path. Without this guard the last slice
            // overlay wins and its per-slice min=1 leaks to the base sub-
            // element (e.g. Observation.referenceRange.appliesTo suddenly
            // required for every referenceRange item).
            if (el.sliceName) continue;
            if (typeof el.id === 'string' && el.id.includes(':')) continue;

            if (el.path.startsWith(basePathPrefix + '.')) {
                const relativePath = el.path.substring(basePathPrefix.length + 1);
                result.set(`${typeCode}.${relativePath}`, el);
            }
        }
        return result;
    }

    /**
     * FHIR cardinality on a nested element (e.g. `qualification.code` min=1)
     * only applies when the parent is actually instantiated. If the direct
     * ancestor is absent/null/empty-array on the resource, the parent's own
     * 0..* cardinality has already permitted the absence — required children
     * must not fire.
     */
    private parentElementAbsent(value: any, subPath: string): boolean {
        if (!subPath.includes('.')) return false;
        const parentSubPath = subPath.substring(0, subPath.lastIndexOf('.'));
        const parentValue = getNestedValue(value, parentSubPath);
        return (
            parentValue === undefined ||
            parentValue === null ||
            (Array.isArray(parentValue) && parentValue.length === 0)
        );
    }

    /**
     * For choice-type elements (value[x]), narrow the type list to the concrete type
     * indicated by the property key suffix. Prevents false-positive URI validation on DateTime values.
     */
    private narrowChoiceType(subPath: string, value: any, elementDef: ElementDefinition): ElementDefinition {
        if (!subPath.endsWith('[x]') || !value || typeof value !== 'object') return elementDef;
        const prefix = subPath.slice(0, -3);
        const actualKey = Object.keys(value).find(k => k.startsWith(prefix) && k !== prefix);
        if (!actualKey || !elementDef.type || elementDef.type.length <= 1) return elementDef;
        const suffix = actualKey.substring(prefix.length);
        const matched = elementDef.type.find(t => t.code.toLowerCase() === suffix.toLowerCase());
        return matched ? { ...elementDef, type: [matched] } : elementDef;
    }

    /**
     * Validate a single sub-element of a complex type.
     */
    private async validateSubElement(
        value: any,
        elementPath: string,
        subElementDef: ElementDefinition,
        typeCode: string,
        basePath: string,
        profileUrl: string,
        parentStructureDef?: StructureDefinition,
        _fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): Promise<ValidationIssue[]> {
        // Extract relative sub-path
        let subPath: string;
        if (elementPath.startsWith(`${typeCode}.`)) {
            subPath = elementPath.substring(typeCode.length + 1);
        } else {
            subPath = subElementDef.path.replace(`${typeCode}.`, '');
            if (subPath.includes('.')) {
                const prefix = basePath.replace(/\[\d+\]/g, '');
                if (subPath.startsWith(prefix + '.')) {
                    subPath = subPath.substring(prefix.length + 1);
                }
            }
        }

        const fullPath = `${basePath}.${subPath}`;
        const effectiveElementDef = this.narrowChoiceType(subPath, value, subElementDef);

        // Resolve value with fallback
        let subValue = getNestedValue(value, subPath);
        if (subValue === undefined && !subPath.includes('.') && value && typeof value === 'object' && subPath in value) {
            subValue = value[subPath];
        }

        const isValueMissing = subValue === undefined || subValue === null ||
            (typeof subValue === 'string' && subValue.trim().length === 0);
        const minCardinality = subElementDef.min ?? 0;

        if (isValueMissing && minCardinality > 0) {
            if (this.parentElementAbsent(value, subPath)) return [];
            return [createValidationIssue({
                code: 'structural-required-element-missing',
                path: fullPath,
                resourceType: value?.resourceType || 'Unknown',
                profile: profileUrl,
                messageParams: { element: fullPath },
            })];
        } else if (typeof subValue === 'object' && subValue !== null) {
            // Determine whether this element is declared as a primitive
            // type. If so, the value (which may be an array like
            // `given: [42]`) should go through TypeValidator for per-
            // item type checking rather than recursing into the complex-
            // type walker which would silently skip non-object array items.
            const declaredTypes = effectiveElementDef.type?.map(t => t.code) || [];
            const allPrimitive = declaredTypes.length > 0 && declaredTypes.every(t => isPrimitiveType(t));
            if (allPrimitive && this.typeValidator) {
                const issues: ValidationIssue[] = [];
                const typeIssues = await this.typeValidator.validate(subValue, effectiveElementDef.type || [], fullPath, profileUrl);
                issues.push(...typeIssues);
                return issues;
            }
            return this.validateComplexTypeSubElements(subValue, effectiveElementDef, fullPath, profileUrl, parentStructureDef, _fhirVersion);
        } else if (subValue !== undefined && subValue !== null) {
            const issues: ValidationIssue[] = [];

            // Check required bindings on this primitive leaf. Records
            // used to only evaluate bindings declared on elements in the
            // top-level resource SD (see terminology-executor.ts);
            // bindings on sub-elements of complex types
            // (e.g. Timing.repeat.periodUnit) were silently skipped.
            //
            // We only check `required` strength here. `extensible` would
            // fire a lot of false-positive warnings on value sets that
            // are not bundled (like ExpressionLanguage / BCP-47) and that
            // Java doesn't bother with — see the mr-covid-m4 regression
            // note. A future Phase C pass can widen this once the
            // value-set resolver gracefully reports "can't check" without
            // emitting an issue.
            if (effectiveElementDef.binding && effectiveElementDef.binding.strength === 'required') {
                try {
                    const bindingIssues = await this.valueSetValidator.validateBinding(
                        subValue,
                        subElementDef.binding,
                        fullPath,
                        { profileUrl }
                    );
                    issues.push(...bindingIssues);
                } catch (err) {
                    logger.debug(`[ComplexTypeValidator] binding check failed for ${fullPath}:`, err);
                }
            }

            if (this.typeValidator) {
                const typeIssues = await this.typeValidator.validate(subValue, effectiveElementDef.type || [], fullPath, profileUrl);
                issues.push(...typeIssues);
            }
            return issues;
        }
        return [];
    }

    /**
     * Resolve which of the allowed types best matches the value
     * Used for polymorphic elements (value[x]) where multiple types are allowed
     */
    private async resolveMatchingType(value: any, types: ElementDefinition['type'], fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): Promise<{ code: string } | undefined> {
        if (!types || types.length === 0) return undefined;
        if (types.length === 1) return types[0];

        // Filter out primitive types as ComplexTypeValidator ignores them anyway
        const complexCandidates = types.filter(t => !isPrimitiveType(t.code));

        if (complexCandidates.length === 0) return types[0]; // Fallback
        if (complexCandidates.length === 1) return complexCandidates[0];

        // If generic object without keys, can't determine
        const valueKeys = Object.keys(value);
        if (valueKeys.length === 0) return complexCandidates[0];

        let bestMatch = complexCandidates[0];
        let maxMatches = -1;

        // Find the type that defines the most keys present in the value
        for (const type of complexCandidates) {
            try {
                // Load definition to get fields
                // Note: basic caching in sdLoader makes this relatively cheap
                const def = await this.loadTypeDefinition(type.code, fhirVersion);
                if (!def?.snapshot?.element) continue;

                // valid keys for this type are immediate children of the root
                const validKeys = new Set(def.snapshot.element
                    .filter(e => {
                        const parts = e.path.split('.');
                        return parts.length === 2 && parts[0] === type.code;
                    })
                    .map(e => e.path.split('.')[1]));

                // Count how many keys in the value are valid for this type
                const matchCount = valueKeys.filter(k => validKeys.has(k)).length;

                logger.debug(`[ComplexTypeValidator] Type candidate ${type.code}: matched ${matchCount} keys (${valueKeys.filter(k => validKeys.has(k)).join(',')})`);

                if (matchCount > maxMatches) {
                    maxMatches = matchCount;
                    bestMatch = type;
                }
            } catch {
                // Ignore load errors
            }
        }

        logger.debug(`[ComplexTypeValidator] Resolved ${types.map(t => t.code).join('|')} -> ${bestMatch.code}`);
        return bestMatch;
    }
}
