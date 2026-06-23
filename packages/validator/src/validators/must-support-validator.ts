import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { StructureDefinition } from '../core/structure-definition-types';
import { getValidationTargets } from '../business-rules';
import {
    isValueEmpty,
    getDirectValue
} from '../core/executors/structural-executor-helpers';

const CHOICE_BASES = [
    'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
    'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
    'product', 'serviced', 'location', 'allowed', 'used',
    'rate', 'born', 'age',
];

function hasChoiceValue(element: any, base: string): boolean {
    if (!element || typeof element !== 'object') return false;
    if (!isValueEmpty(element[base])) return true;

    return Object.keys(element).some(key =>
        key.startsWith(base) &&
        key.length > base.length &&
        key[base.length] === key[base.length].toUpperCase() &&
        !isValueEmpty(element[key])
    );
}

function hasAnyChoiceValue(element: any): boolean {
    return CHOICE_BASES.some(base => hasChoiceValue(element, base));
}

function hasOldAddress(resource: any): boolean {
    return Array.isArray(resource.address) &&
        resource.address.some((address: any) => address?.use === 'old');
}

function hasArrayContent(value: any): boolean {
    return Array.isArray(value) && value.length > 0;
}

function hasEncounterReasonContext(resource: any): boolean {
    return hasArrayContent(resource.type) ||
        hasArrayContent(resource.reasonReference) ||
        hasArrayContent(resource.diagnosis);
}

function isOptionalPerInstanceObservationSupport(path: string): boolean {
    return /^Observation\.(performer|specimen|interpretation|referenceRange)$/i.test(path);
}

function isOptionalPerInstanceDiagnosticReportSupport(path: string): boolean {
    return /^DiagnosticReport\.resultsInterpreter$/i.test(path);
}

function isOptionalPerInstancePatientAddressSupport(path: string): boolean {
    return /^Patient\.address\.postalCode$/i.test(path);
}

/**
 * Validator for MustSupport elements
 * Handles validation of elements marked with mustSupport=true
 */
export class MustSupportValidator {
    private mustSupportSeverity: 'error' | 'warning' | 'information' = 'warning';

    /**
     * Configure mustSupport validation severity
     */
    setMustSupportSeverity(severity: 'error' | 'warning' | 'information'): void {
        this.mustSupportSeverity = severity;
    }

    /**
     * Validate a single mustSupport element
     */
    validateMustSupportElement(
        path: string,
        profileUrl: string,
        resource?: any,
        elementDef: { sliceName?: string } = {}
    ): ValidationIssue[] {
        if (resource && this.shouldSkipMustSupportElement(resource, path, elementDef)) {
            return [];
        }

        return [createValidationIssue({
            code: 'profile-mustsupport-missing',
            path,
            resourceType: resource?.resourceType || 'Unknown',
            profile: profileUrl,
            messageParams: { element: path },
            severityOverride: this.mustSupportSeverity === 'information'
                ? 'info'
                : this.mustSupportSeverity,
        })];
    }

    /**
     * Check if a mustSupport element should be skipped (false positive filters).
     */
    private shouldSkipMustSupportElement(
        resource: any, path: string, elementDef: { sliceName?: string }
    ): boolean {
        // Skip generic extension paths without slice discriminator
        if (path.endsWith('.extension') && !elementDef.sliceName) return true;

        // Skip primitive element extensions (_elementName.extension)
        const pathParts = path.split('.');
        const lastPart = pathParts[pathParts.length - 1];
        const secondToLast = pathParts[pathParts.length - 2];
        if (lastPart === 'extension' && secondToLast?.startsWith('_')) return true;

        // MustSupport is a system support obligation, not a blanket
        // per-instance cardinality rule. These optional elements created
        // high-volume false positives in public-server runs when absent from
        // otherwise valid resources.
        if (resource.resourceType === 'Observation' && isOptionalPerInstanceObservationSupport(path)) {
            return true;
        }
        if (resource.resourceType === 'DiagnosticReport' && isOptionalPerInstanceDiagnosticReportSupport(path)) {
            return true;
        }
        if (resource.resourceType === 'Patient' && isOptionalPerInstancePatientAddressSupport(path)) {
            return true;
        }

        // For Observation.value[x], dataAbsentReason satisfies the requirement
        if (path === 'Observation.value[x]' || path.match(/^Observation\.value\[x\]$/i)) {
            if (resource.dataAbsentReason && !isValueEmpty(resource.dataAbsentReason)) return true;

            // Blood pressure/panel-style Observations legitimately carry their
            // measurements in component.value[x] rather than top-level value[x].
            if (Array.isArray(resource.component) && resource.component.some(hasAnyChoiceValue)) return true;
        }

        // Simple vital-sign Observations legitimately carry their measurement
        // in top-level value[x] rather than component[]. Reporting the
        // component element itself as missing adds noise and contradicts the
        // value/component alternative.
        if (path.match(/^Observation\.component$/i)) {
            if (hasChoiceValue(resource, 'value')) return true;
            if (resource.dataAbsentReason && !isValueEmpty(resource.dataAbsentReason)) return true;
        }

        // Observation.dataAbsentReason explains why Observation.value[x] is
        // absent. If the observation already has a value, or represents a
        // component panel with valued components, requiring dataAbsentReason is
        // the inverse of the intended alternative.
        if (path.match(/^Observation\.dataAbsentReason$/i)) {
            if (hasChoiceValue(resource, 'value')) return true;
            if (Array.isArray(resource.component) && resource.component.some(hasAnyChoiceValue)) return true;
        }

        // For Observation.component.value[x], check component dataAbsentReason
        if (path.match(/^Observation\.component\.value\[x\]$/i)) {
            const components = resource.component;
            if (Array.isArray(components) && components.length > 0) {
                if (components.every((c: any) => c.dataAbsentReason && !isValueEmpty(c.dataAbsentReason))) {
                    return true;
                }
            }
        }

        // For component dataAbsentReason, a concrete component.value[x] is the
        // positive evidence. Requiring dataAbsentReason in addition to a value
        // is the inverse of the FHIR invariant.
        if (path.match(/^Observation\.component(?::[^.]+)?\.dataAbsentReason$/i)) {
            const components = resource.component;
            if (Array.isArray(components) && components.length > 0) {
                if (components.every(hasAnyChoiceValue)) return true;
            }
        }

        // Encounter.hospitalization is only clinically meaningful for
        // inpatient-style encounters. Many profiles mark the element as
        // MustSupport so systems can exchange it when present, but ambulatory
        // visits should not be reported as missing hospitalization data.
        if (path.match(/^Encounter\.hospitalization$/i)) {
            const classCode = resource.class?.code;
            if (typeof classCode === 'string' && classCode !== 'IMP') return true;
        }

        // Encounter.reasonCode is an optional MustSupport element in US Core.
        // Treat an already-classified encounter as contextually covered instead
        // of reporting every routine typed visit as missing a coded reason.
        if (path.match(/^Encounter\.reasonCode$/i) && hasEncounterReasonContext(resource)) {
            return true;
        }

        // Patient.address.period is useful for historical addresses, but a
        // current address without a period is not incomplete data. Treat it as
        // contextually applicable only when an old address is present.
        if (path.match(/^Patient\.address\.period$/i) && !hasOldAddress(resource)) {
            return true;
        }

        return false;
    }

    /**
     * Check if a mustSupport element exists using multiple resolution strategies.
     */
    private checkElementExists(
        resource: any, path: string,
        getValueAtPath: (resource: any, path: string) => any
    ): boolean {
        // Method 1: Array-aware validation targets
        const targets = getValidationTargets(resource, path);
        if (targets.some(t => !isValueEmpty(t.value))) return true;

        // Method 2: Direct property access
        if (!isValueEmpty(getDirectValue(resource, path))) return true;

        // Method 3: getValueAtPath (most reliable)
        try {
            if (!isValueEmpty(getValueAtPath(resource, path))) return true;
        } catch { /* invalid paths may throw */ }

        return false;
    }

    /**
     * Validate all mustSupport elements in the profile snapshot
     * This ensures comprehensive mustSupport checking even for elements that might be missed in the main loop
     * Uses array-aware validation like required fields validation
     */
    async validateAllMustSupportElements(
        resource: any,
        structureDef: StructureDefinition,
        profileUrl: string,
        getValueAtPath: (resource: any, path: string) => any,
        alreadyCheckedPaths: Set<string> = new Set()
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!structureDef.snapshot?.element) {
            return issues;
        }

        for (const elementDef of structureDef.snapshot.element) {
            if (elementDef.mustSupport !== true) continue;

            const path = elementDef.path;

            // Skip root element
            if (path === resource.resourceType) continue;

            // Skip SD definition children — these are element definitions, not data
            if (resource.resourceType === 'StructureDefinition' &&
                (path.startsWith('StructureDefinition.snapshot.element.') ||
                 path.startsWith('StructureDefinition.differential.element.'))) {
                continue;
            }

            if (alreadyCheckedPaths.has(path)) continue;
            if (this.shouldSkipMustSupportElement(resource, path, elementDef)) continue;

            // Avoid cascading false positives for deep child paths when the
            // repeatable/complex parent is absent. Report the parent itself,
            // but let skeleton/profile handlers expose its children on demand.
            const parentPath = path.split('.').slice(0, -1).join('.');
            if (
                parentPath &&
                parentPath !== resource.resourceType &&
                !this.checkElementExists(resource, parentPath, getValueAtPath)
            ) {
                continue;
            }

            if (!this.checkElementExists(resource, path, getValueAtPath)) {
                issues.push(createValidationIssue({
                    code: 'profile-mustsupport-missing',
                    path,
                    resourceType: resource.resourceType,
                    profile: profileUrl,
                    messageParams: { element: path },
                    severityOverride: this.mustSupportSeverity === 'information'
                        ? 'info'
                        : this.mustSupportSeverity,
                }));
            }
        }

        return issues;
    }
}
