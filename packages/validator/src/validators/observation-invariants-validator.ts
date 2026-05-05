/**
 * Observation Invariants Validator
 * 
 * Resource-specific invariants for Observation resources:
 * - obs-6: dataAbsentReason SHALL only be present if value[x] is not present
 * - obs-7: If code is same as a component code, value SHALL NOT be present
 * - obs-3: referenceRange only makes sense for Quantity/integer/decimal values
 * - vs-3: vital-signs components without value[x] SHALL have dataAbsentReason
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface ObservationComponent {
    code?: {
        coding?: Array<{ system?: string; code?: string }>;
    };
    valueQuantity?: any;
    valueCodeableConcept?: any;
    valueString?: string;
    valueBoolean?: boolean;
    valueInteger?: number;
    valueRange?: any;
    valueRatio?: any;
    valueSampledData?: any;
    valueTime?: string;
    valueDateTime?: string;
    valuePeriod?: any;
    dataAbsentReason?: any;
}

// ============================================================================
// Observation Invariants Validator
// ============================================================================

export class ObservationInvariantsValidator {

    /**
     * Validate all Observation-specific invariants
     */
    validate(resource: any): ValidationIssue[] {
        if (resource?.resourceType !== 'Observation') {
            return [];
        }

        const issues: ValidationIssue[] = [];

        logger.debug('[ObservationInvariants] Validating Observation invariants');

        // obs-6: dataAbsentReason XOR value[x]
        issues.push(...this.validateObs6(resource));

        // obs-7: component code != observation code when value present
        issues.push(...this.validateObs7(resource));

        // obs-3: referenceRange type check
        issues.push(...this.validateObs3(resource));

        // vs-3: Vital Signs component value/dataAbsentReason check
        issues.push(...this.validateVs3(resource));

        return issues;
    }

    /**
     * obs-6: dataAbsentReason SHALL only be present if value[x] is not present
     * 
     * Expression: dataAbsentReason.empty() or value.empty()
     * Severity: error
     */
    private validateObs6(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const hasValue = this.hasValue(resource);
        const hasDataAbsentReason = !!resource.dataAbsentReason;

        if (hasValue && hasDataAbsentReason) {
            issues.push(createValidationIssue({
                code: 'obs-6-violation',
                path: 'Observation',
                resourceType: 'Observation',
                customMessage: 'obs-6: dataAbsentReason SHALL only be present if value[x] is not present',
                severityOverride: 'error',
            }));
        }

        // Also check components
        if (resource.component && Array.isArray(resource.component)) {
            for (let i = 0; i < resource.component.length; i++) {
                const comp = resource.component[i];
                const compHasValue = this.hasComponentValue(comp);
                const compHasDataAbsentReason = !!comp.dataAbsentReason;

                if (compHasValue && compHasDataAbsentReason) {
                    issues.push(createValidationIssue({
                        code: 'obs-6-violation',
                        path: `Observation.component[${i}]`,
                        resourceType: 'Observation',
                        customMessage: 'obs-6: component.dataAbsentReason SHALL only be present if component.value[x] is not present',
                        severityOverride: 'error',
                    }));
                }
            }
        }

        return issues;
    }

    /**
     * obs-7: If the code is the same as a component code then the value element 
     * associated with the code SHALL NOT be present
     * 
     * Expression: value.empty() or component.code.where(coding.intersect(%resource.code.coding).exists()).empty()
     * Severity: error
     */
    private validateObs7(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        const hasValue = this.hasValue(resource);
        if (!hasValue) {
            return issues; // No value, constraint satisfied
        }

        if (!resource.component || !Array.isArray(resource.component)) {
            return issues; // No components, constraint satisfied
        }

        const observationCodings = resource.code?.coding || [];

        for (let i = 0; i < resource.component.length; i++) {
            const component = resource.component[i];
            const componentCodings = component.code?.coding || [];

            // Check if any component coding matches observation coding
            const hasMatchingCode = this.codingsIntersect(observationCodings, componentCodings);

            if (hasMatchingCode) {
                issues.push(createValidationIssue({
                    code: 'obs-7-violation',
                    path: `Observation.component[${i}]`,
                    resourceType: 'Observation',
                    customMessage: 'obs-7: If code is the same as a component code, value element SHALL NOT be present',
                    severityOverride: 'error',
                }));
                break; // One violation is enough
            }
        }

        return issues;
    }

    /**
     * obs-3: referenceRange is only permitted when value is Quantity, integer, decimal, SampledData or time
     * 
     * Expression: referenceRange.empty() or 
     *   (value.is(Quantity) or value.is(integer) or value.is(decimal) or value.is(SampledData) or value.is(time))
     * Severity: error
     */
    private validateObs3(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!resource.referenceRange || !Array.isArray(resource.referenceRange) || resource.referenceRange.length === 0) {
            return issues; // No referenceRange, constraint satisfied
        }

        // Check if value type is valid for referenceRange
        const validValueTypes = [
            'valueQuantity',
            'valueInteger',
            'valueDecimal',  // Note: FHIR doesn't have valueDecimal, but integer values can be decimal
            'valueSampledData',
            'valueTime'
        ];

        const hasValidValueType = validValueTypes.some(vt => resource[vt] !== undefined);

        if (!hasValidValueType) {
            issues.push(createValidationIssue({
                code: 'obs-3-violation',
                path: 'Observation.referenceRange',
                resourceType: 'Observation',
                customMessage: 'obs-3: referenceRange is only permitted when value is Quantity, integer, decimal, SampledData or time',
                severityOverride: 'error',
            }));
        }

        return issues;
    }

    private validateVs3(resource: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!this.isVitalSignsObservation(resource)) return issues;
        if (!resource.component || !Array.isArray(resource.component)) return issues;

        for (let i = 0; i < resource.component.length; i++) {
            const component = resource.component[i];
            if (!this.hasComponentValue(component) && !component.dataAbsentReason) {
                issues.push(createValidationIssue({
                    code: 'invariant-vs-3-violation',
                    path: `Observation.component[${i}]`,
                    resourceType: 'Observation',
                    customMessage: 'vs-3: If there is no a value a data absent reason must be present',
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

    private isVitalSignsObservation(resource: any): boolean {
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

    /**
     * Check if Observation has any value[x] element
     */
    private hasValue(resource: any): boolean {
        const valueFields = [
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
            'valuePeriod'
        ];

        return valueFields.some(field => resource[field] !== undefined);
    }

    /**
     * Check if component has any value[x] element
     */
    private hasComponentValue(component: any): boolean {
        const valueFields = [
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
            'valuePeriod'
        ];

        return valueFields.some(field => component[field] !== undefined);
    }

    /**
     * Check if two coding arrays have any intersection
     */
    private codingsIntersect(
        codings1: Array<{ system?: string; code?: string }>,
        codings2: Array<{ system?: string; code?: string }>
    ): boolean {
        for (const c1 of codings1) {
            for (const c2 of codings2) {
                if (c1.system === c2.system && c1.code === c2.code) {
                    return true;
                }
            }
        }
        return false;
    }
}

// Singleton
export const observationInvariantsValidator = new ObservationInvariantsValidator();
