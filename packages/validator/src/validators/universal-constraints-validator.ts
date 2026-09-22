/**
 * Universal Constraints Validator
 * 
 * Validates universal FHIR constraints that apply to all resources:
 * 
 * - ele-1: All FHIR elements must have a @value or children
 * - ref-1: If reference has a reference, it SHALL be a literal URL or fragment
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import { getPrimitiveSidecar } from '../core/fhir-primitive-sidecar.js';

// ============================================================================
// Universal Constraints Validator
// ============================================================================

export class UniversalConstraintsValidator {

    /**
     * ele-1 only, for callers that already cover references elsewhere.
     *
     * The reference aspect owns both halves of what `validateRef1` looks at:
     * the real ref-1 invariant ("SHALL have a contained resource if a local
     * reference is provided") is emitted as `reference-ref1-invariant` by
     * reference-contained-validation.ts, and the reference *format* rules this
     * class actually implements are emitted as `reference-invalid-format` /
     * `reference-invalid-bundle-relative` by reference-format-validator.ts.
     * Calling `validate()` where that aspect already runs reports the same
     * defect twice. ele-1 has no such second owner.
     */
    validateElementConstraints(resource: unknown): ValidationIssue[] {
        const record = this.asResourceRecord(resource);
        if (!record) return [];

        const resourceType = record.resourceType as string;
        logger.debug(`[UniversalConstraints] Validating ele-1 on ${resourceType}`);

        return this.validateEle1(record, resourceType, resourceType, new WeakSet<object>());
    }

    private asResourceRecord(resource: unknown): Record<string, unknown> | null {
        if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return null;
        const record = resource as Record<string, unknown>;
        if (typeof record.resourceType !== 'string' || record.resourceType.length === 0) return null;
        return record;
    }

    /**
     * Validate universal constraints on any resource
     */
    validate(resource: unknown): ValidationIssue[] {
        if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return [];
        const record = resource as Record<string, unknown>;
        if (typeof record.resourceType !== 'string' || record.resourceType.length === 0) return [];

        const issues: ValidationIssue[] = [];
        const resourceType = record.resourceType;

        logger.debug(`[UniversalConstraints] Validating ${resourceType}`);

        // ele-1: All FHIR elements must have a @value or children
        issues.push(...this.validateEle1(
            record,
            resourceType,
            resourceType,
            new WeakSet<object>(),
        ));

        // ref-1: References must be valid
        issues.push(...this.validateRef1(
            record,
            resourceType,
            resourceType,
            new WeakSet<object>(),
        ));

        return issues;
    }

    /**
     * ele-1: All FHIR elements must have a @value or children
     * 
     * Expression: hasValue() or (children().count() > id.count()) or $this is Parameters
     * Human: All FHIR elements must have a @value or children
     */
    private validateEle1(
        obj: unknown,
        resourceType: string,
        path: string,
        visited: WeakSet<object>,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!obj || typeof obj !== 'object') return issues;
        if (visited.has(obj)) return issues;
        visited.add(obj);

        // Skip arrays, process items individually
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                issues.push(...this.validateEle1(obj[i], resourceType, `${path}[${i}]`, visited));
            }
            return issues;
        }

        // Check for empty objects (no value and no children).
        // Primitive sidecars (_field) count as children only when they carry
        // meaningful FHIR content such as id or extensions.
        const record = obj as Record<string, unknown>;
        const keys = Object.keys(record).filter(k => !k.startsWith('_'));
        const contentKeys = keys.filter(key => key !== 'id');
        const primitiveSidecarKeys = Object.keys(record).filter(k =>
            k.startsWith('_') && k.length > 1 && getPrimitiveSidecar(record, k.slice(1)) !== undefined
        );

        // Empty object check
        if (contentKeys.length === 0 && primitiveSidecarKeys.length === 0) {
            // Allow empty at root level or in certain contexts
            if (path !== resourceType && !path.includes('.extension')) {
                issues.push(createValidationIssue({
                    code: 'ele-1-violation',
                    path,
                    resourceType,
                    customMessage: 'ele-1: All FHIR elements must have a @value or children',
                    severityOverride: 'error',
                }));
            }
        }

        // ele-1 subtracts id from the child count — `hasValue() or
        // (children().count() > id.count())`. A primitive written as
        // <implicitRules id="i1"/> has no value, and its only child is the id
        // the expression discounts, so it satisfies neither branch.
        for (const sidecarKey of primitiveSidecarKeys) {
            const name = sidecarKey.slice(1);
            if (record[name] !== undefined) continue;
            // Extensions answer to ext-1, not ele-1 — the empty-object branch
            // below has always excluded them and this branch must match.
            if (path.includes('.extension') || name === 'extension') continue;
            const raw = record[sidecarKey];
            const entries = Array.isArray(raw) ? raw : [raw];
            entries.forEach((entry, index) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
                const carried = Object.keys(entry as Record<string, unknown>).filter(k => k !== 'id');
                if (carried.length > 0) return;
                issues.push(createValidationIssue({
                    code: 'ele-1-violation',
                    path: `${path}.${name}${Array.isArray(raw) ? `[${index}]` : ''}`,
                    resourceType,
                    customMessage: 'ele-1: All FHIR elements must have a @value or children',
                    severityOverride: 'error',
                }));
            });
        }

        // Recurse into children
        for (const key of keys) {
            // Narrative is XHTML, not FHIR elements. When its namespace is
            // wrong the converter hands it over as a walked tree, and every
            // <p> in it would otherwise be judged against ele-1.
            if (key === 'div' && path.endsWith('.text')) continue;
            if (typeof record[key] === 'object' && record[key] !== null) {
                issues.push(...this.validateEle1(record[key], resourceType, `${path}.${key}`, visited));
            }
        }
        for (const key of primitiveSidecarKeys) {
            const childPath = `${path}.${key.slice(1)}`;
            const sidecar = getPrimitiveSidecar(record, key.slice(1));
            if (!sidecar || typeof sidecar !== 'object') continue;
            // A sidecar carrying nothing but the element id is not its own
            // element: paired with a value it satisfies ele-1 through the
            // pairing, and value-less it is already reported by the sidecar
            // branch above. Recursing would judge `{ id }` as an empty object.
            const carriesOnlyId = !Array.isArray(sidecar)
                && Object.keys(sidecar as Record<string, unknown>).every(k => k === 'id');
            if (carriesOnlyId) continue;
            issues.push(...this.validateEle1(sidecar, resourceType, childPath, visited));
        }

        return issues;
    }

    /**
     * ref-1: If reference has a reference, SHALL have a literal URL or fragment
     * 
     * Expression: reference.exists() implies (reference.startsWith('#') or reference.contains('/'))
     * Human: SHALL have a contained resource if a local reference is provided
     */
    private validateRef1(
        obj: unknown,
        resourceType: string,
        path: string,
        visited: WeakSet<object>,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!obj || typeof obj !== 'object') return issues;
        if (visited.has(obj)) return issues;
        visited.add(obj);

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                issues.push(...this.validateRef1(obj[i], resourceType, `${path}[${i}]`, visited));
            }
            return issues;
        }

        // Check for reference field
        const record = obj as Record<string, unknown>;
        if (record.reference !== undefined) {
            const ref = record.reference;

            if (typeof ref === 'string' && ref.length > 0) {
                // ref-1: reference must be a fragment, URL/relative URL, or URN.
                const isFragment = ref.startsWith('#');
                const isLiteralUrl = ref.includes('/');
                const isConditionalReference = /^[A-Z][a-zA-Z]+\?.+$/.test(ref);
                const isUrn = ref.startsWith('urn:');

                if (!isFragment && !isLiteralUrl && !isConditionalReference && !isUrn) {
                    issues.push(createValidationIssue({
                        code: 'ref-1-violation',
                        path: `${path}.reference`,
                        resourceType,
                        customMessage: 'ref-1: Reference must be a fragment (#id), literal URL (Type/id), or URN',
                        severityOverride: 'error',
                    }));
                }
            }
        }

        // Recurse into children
        for (const [key, value] of Object.entries(record)) {
            if (typeof value === 'object' && value !== null && key !== 'reference') {
                issues.push(...this.validateRef1(value, resourceType, `${path}.${key}`, visited));
            }
        }

        return issues;
    }
}

// Singleton
export const universalConstraintsValidator = new UniversalConstraintsValidator();
