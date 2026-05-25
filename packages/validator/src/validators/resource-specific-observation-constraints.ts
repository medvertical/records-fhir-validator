import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

export function validateObservationConstraints(resource: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    logger.debug('[ResourceConstraints] Validating Observation constraints');

    if (resource.referenceRange && Array.isArray(resource.referenceRange)) {
        for (let i = 0; i < resource.referenceRange.length; i++) {
            const rr = resource.referenceRange[i];
            if (!rr.low && !rr.high && !rr.text) {
                issues.push(createValidationIssue({
                    code: 'obs-3-violation',
                    path: `Observation.referenceRange[${i}]`,
                    resourceType: 'Observation',
                    customMessage: 'obs-3: Must have at least a low or a high or text',
                    severityOverride: 'error',
                }));
            }
        }
    }

    const hasValue = observationHasValue(resource);
    if (resource.dataAbsentReason && hasValue) {
        issues.push(createValidationIssue({
            code: 'obs-6-violation',
            path: 'Observation.dataAbsentReason',
            resourceType: 'Observation',
            customMessage: 'obs-6: dataAbsentReason SHALL only be present if Observation.value[x] is not present',
            severityOverride: 'error',
        }));
    }

    if (hasValue && resource.component && Array.isArray(resource.component)) {
        const obsCodes = getCodingSet(resource.code);
        if (obsCodes.size > 0) {
            for (const comp of resource.component) {
                const compCodes = getCodingSet(comp.code);
                for (const c of compCodes) {
                    if (obsCodes.has(c)) {
                        issues.push(createValidationIssue({
                            code: 'obs-7-violation',
                            path: 'Observation.value[x]',
                            resourceType: 'Observation',
                            customMessage: 'obs-7: If Observation.code is the same as a component.code, the value element SHALL NOT be present',
                            severityOverride: 'error',
                        }));
                        return issues;
                    }
                }
            }
        }
    }

    if (isVitalSignsObservation(resource) && Array.isArray(resource.component)) {
        for (let i = 0; i < resource.component.length; i++) {
            const component = resource.component[i];
            if (!observationHasValue(component) && !component.dataAbsentReason) {
                issues.push(createValidationIssue({
                    code: 'invariant-vs-3-violation',
                    path: `Observation.component[${i}]`,
                    resourceType: 'Observation',
                    customMessage: 'vs-3: If there is no a value a data absent reason must be present',
                    severityOverride: 'error',
                }));
            }
        }
    }

    return issues;
}

function observationHasValue(resource: any): boolean {
    return !!(resource.valueQuantity || resource.valueCodeableConcept ||
        resource.valueString || resource.valueBoolean || resource.valueInteger ||
        resource.valueRange || resource.valueRatio || resource.valueSampledData ||
        resource.valueTime || resource.valueDateTime || resource.valuePeriod);
}

function getCodingSet(codeableConcept: any): Set<string> {
    const codes = new Set<string>();
    if (codeableConcept?.coding && Array.isArray(codeableConcept.coding)) {
        for (const coding of codeableConcept.coding) {
            if (coding.system && coding.code) {
                codes.add(`${coding.system}|${coding.code}`);
            }
        }
    }
    return codes;
}

function isVitalSignsObservation(resource: any): boolean {
    if (Array.isArray(resource?.category)) {
        for (const category of resource.category) {
            for (const coding of category?.coding || []) {
                if (
                    coding?.system === 'http://terminology.hl7.org/CodeSystem/observation-category' &&
                    coding?.code === 'vital-signs'
                ) {
                    return true;
                }
            }
        }
    }

    return (resource?.meta?.profile || []).some((profile: string) =>
        typeof profile === 'string' && /vital|oxygen|pulse-ox/i.test(profile)
    );
}
