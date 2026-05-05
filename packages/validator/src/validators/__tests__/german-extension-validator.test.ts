/**
 * German Extension Validator Tests
 * 
 * Tests validation of German-specific extension requirements
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GermanExtensionValidator } from '../german-extension-validator';

describe('GermanExtensionValidator', () => {
    let validator: GermanExtensionValidator;

    beforeEach(() => {
        validator = new GermanExtensionValidator();
    });

    describe('validateExtensions', () => {
        it('should return no issues for non-Patient resources', () => {
            const resource = { resourceType: 'Observation' } as any;
            const issues = validator.validateExtensions(resource, 'http://fhir.de/profile/Observation');
            expect(issues).toHaveLength(0);
        });

        it('should return no issues when gender is not "other"', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'female' as const,
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(0);
        });

        it('should return no issues when gender is "male"', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'male' as const,
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(0);
        });

        it('should return no issues when gender is "unknown"', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'unknown' as const,
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(0);
        });

        it('should report error when gender is "other" without extension', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'other' as const,
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(1);
            expect(issues[0].path).toBe('Patient.gender');
            expect(issues[0].message).toContain('gender-amtlich-de');
            expect(issues[0].message).toContain('other');
        });

        it('should return no issues when gender is "other" with root-level extension', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'other' as const,
                extension: [
                    {
                        url: 'http://fhir.de/StructureDefinition/gender-amtlich-de',
                        valueCoding: {
                            system: 'http://fhir.de/CodeSystem/gender-amtlich-de',
                            code: 'D',
                        },
                    },
                ],
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(0);
        });

        it('should return no issues when gender is "other" with _gender extension', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'other' as const,
                _gender: {
                    extension: [
                        {
                            url: 'http://fhir.de/StructureDefinition/gender-amtlich-de',
                            valueCoding: {
                                system: 'http://fhir.de/CodeSystem/gender-amtlich-de',
                                code: 'X',
                            },
                        },
                    ],
                },
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(0);
        });

        it('should report error when gender is "other" with unrelated extension', () => {
            const patient = {
                resourceType: 'Patient' as const,
                gender: 'other' as const,
                extension: [
                    {
                        url: 'http://example.org/some-other-extension',
                        valueString: 'test',
                    },
                ],
            };
            const issues = validator.validateExtensions(patient, 'http://fhir.de/profile/Patient');
            expect(issues).toHaveLength(1);
            expect(issues[0].message).toContain('gender-amtlich-de');
        });
    });

    describe('isGermanProfile', () => {
        it('should detect fhir.de profiles', () => {
            expect(validator.isGermanProfile('http://fhir.de/StructureDefinition/Patient')).toBe(true);
        });

        it('should detect MII profiles', () => {
            expect(validator.isGermanProfile('https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient')).toBe(true);
        });

        it('should detect KBV profiles', () => {
            expect(validator.isGermanProfile('https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Patient')).toBe(true);
        });

        it('should detect gematik profiles', () => {
            expect(validator.isGermanProfile('https://gematik.de/fhir/erp/StructureDefinition/GEM_ERP_PR_Medication')).toBe(true);
        });

        it('should not detect HL7 FHIR core profiles', () => {
            expect(validator.isGermanProfile('http://hl7.org/fhir/StructureDefinition/Patient')).toBe(false);
        });

        it('should not detect UK Core profiles', () => {
            expect(validator.isGermanProfile('https://fhir.hl7.org.uk/StructureDefinition/UKCore-Patient')).toBe(false);
        });
    });
});
