import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';

const OBSERVATION_VALUE_KEYS = [
    'valueQuantity',
    'valueCodeableConcept',
    'valueString',
    'valueBoolean',
    'valueInteger',
    'valueRange',
    'valueRatio',
    'valueSampledData',
    'valueTime',
    'valueDateTime',
    'valuePeriod',
] as const;

export function validateObservationConstraints(resource: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const observation = asRecord(resource);
    if (!observation) return issues;

    logger.debug('[ResourceConstraints] Validating Observation constraints');

    if (Array.isArray(observation.referenceRange)) {
        for (let i = 0; i < observation.referenceRange.length; i++) {
            const range = asRecord(observation.referenceRange[i]);
            if (range && !range.low && !range.high && !range.text) {
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

    const hasValue = observationHasValue(observation);
    if (observation.dataAbsentReason && hasValue) {
        issues.push(createValidationIssue({
            code: 'obs-6-violation',
            path: 'Observation.dataAbsentReason',
            resourceType: 'Observation',
            customMessage: 'obs-6: dataAbsentReason SHALL only be present if Observation.value[x] is not present',
            severityOverride: 'error',
        }));
    }

    if (hasValue && Array.isArray(observation.component)) {
        const obsCodes = getCodingSet(observation.code);
        if (obsCodes.size > 0) {
            for (const component of observation.component) {
                const compCodes = getCodingSet(asRecord(component)?.code);
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

    if (isVitalSignsObservation(observation) && Array.isArray(observation.component)) {
        for (let i = 0; i < observation.component.length; i++) {
            const component = asRecord(observation.component[i]);
            if (component && !observationHasValue(component) && !component.dataAbsentReason) {
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

function observationHasValue(resource: unknown): boolean {
    const record = asRecord(resource);
    return record !== undefined && OBSERVATION_VALUE_KEYS.some(key => Boolean(record[key]));
}

function getCodingSet(codeableConcept: unknown): Set<string> {
    const codes = new Set<string>();
    const concept = asRecord(codeableConcept);
    if (Array.isArray(concept?.coding)) {
        for (const item of concept.coding) {
            const coding = asRecord(item);
            if (typeof coding?.system === 'string' && typeof coding.code === 'string') {
                codes.add(`${coding.system}|${coding.code}`);
            }
        }
    }
    return codes;
}

function isVitalSignsObservation(resource: Record<string, unknown>): boolean {
    if (Array.isArray(resource.category)) {
        for (const category of resource.category) {
            const codings = asRecord(category)?.coding;
            if (!Array.isArray(codings)) continue;
            for (const item of codings) {
                const coding = asRecord(item);
                if (
                    coding?.system === 'http://terminology.hl7.org/CodeSystem/observation-category' &&
                    coding?.code === 'vital-signs'
                ) {
                    return true;
                }
            }
        }
    }

    const profiles = asRecord(resource.meta)?.profile;
    return Array.isArray(profiles)
        && profiles.some(profile => typeof profile === 'string' && /vital|oxygen|pulse-ox/i.test(profile));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
