/**
 * German Identifier Validator Tests
 * 
 * Tests validation of GKV/PKV identifier assigner systems
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GermanIdentifierValidator } from '../german-identifier-validator';

describe('GermanIdentifierValidator', () => {
    let validator: GermanIdentifierValidator;

    beforeEach(() => {
        validator = new GermanIdentifierValidator();
    });

    describe('validateIdentifiers', () => {
        it('should return no issues for resource without identifiers', () => {
            const resource = { resourceType: 'Patient' };
            const issues = validator.validateIdentifiers(resource as any, 'http://example.org/profile');
            expect(issues).toHaveLength(0);
        });

        it('should skip non-German identifier systems', () => {
            const resource = {
                resourceType: 'Patient',
                identifier: [
                    {
                        system: 'http://example.org/mrn',
                        value: '12345',
                    },
                ],
            };
            const issues = validator.validateIdentifiers(resource as any, 'http://example.org/profile');
            expect(issues).toHaveLength(0);
        });

        it('should validate GKV identifier with correct assigner system', () => {
            const resource = {
                resourceType: 'Patient',
                identifier: [
                    {
                        system: 'http://fhir.de/sid/gkv/kvid-10',
                        value: 'A123456789',
                        assigner: {
                            identifier: {
                                system: 'http://fhir.de/sid/arge-ik/iknr',
                                value: '123456789',
                            },
                        },
                    },
                ],
            };
            const issues = validator.validateIdentifiers(resource as any, 'http://fhir.de/profile/PatientIn');
            expect(issues).toHaveLength(0);
        });

        it('should report error for GKV identifier with invalid assigner system', () => {
            const resource = {
                resourceType: 'Patient',
                identifier: [
                    {
                        system: 'http://fhir.de/sid/gkv/kvid-10',
                        value: 'A123456789',
                        assigner: {
                            identifier: {
                                system: 'http://invalid-system.example.com/wrong-system',
                                value: '123456789',
                            },
                        },
                    },
                ],
            };
            const issues = validator.validateIdentifiers(resource as any, 'http://fhir.de/profile/PatientIn');
            expect(issues).toHaveLength(1);
            expect(issues[0].message).toContain('GKV');
            expect(issues[0].message).toContain('http://fhir.de/sid/arge-ik/iknr');
            expect(issues[0].path).toBe('Patient.identifier[0].assigner.identifier.system');
        });

        it('should report error for GKV identifier with missing assigner system', () => {
            const resource = {
                resourceType: 'Patient',
                identifier: [
                    {
                        system: 'http://fhir.de/sid/gkv/kvid-10',
                        value: 'A123456789',
                        assigner: {
                            identifier: {
                                value: '123456789',
                                // system is missing
                            },
                        },
                    },
                ],
            };
            const issues = validator.validateIdentifiers(resource as any, 'http://fhir.de/profile/PatientIn');
            expect(issues).toHaveLength(1);
            expect(issues[0].path).toBe('Patient.identifier[0].assigner.identifier.system');
        });

        it('should validate PKV identifier similarly to GKV', () => {
            const resource = {
                resourceType: 'Patient',
                identifier: [
                    {
                        system: 'http://fhir.de/sid/pkv/kvid-10',
                        value: 'P123456789',
                        assigner: {
                            identifier: {
                                system: 'http://invalid-system.example.com/wrong-system',
                                value: '987654321',
                            },
                        },
                    },
                ],
            };
            const issues = validator.validateIdentifiers(resource as any, 'http://fhir.de/profile/PatientIn');
            expect(issues).toHaveLength(1);
            expect(issues[0].message).toContain('PKV');
        });

        it('should validate multiple identifiers independently', () => {
            const resource = {
                resourceType: 'Patient',
                identifier: [
                    {
                        system: 'http://fhir.de/sid/gkv/kvid-10',
                        value: 'A123456789',
                        assigner: {
                            identifier: {
                                system: 'http://fhir.de/sid/arge-ik/iknr', // correct
                                value: '123456789',
                            },
                        },
                    },
                    {
                        system: 'http://fhir.de/sid/pkv/kvid-10',
                        value: 'P123456789',
                        assigner: {
                            identifier: {
                                system: 'http://wrong-system.example.com', // incorrect
                                value: '987654321',
                            },
                        },
                    },
                ],
            };
            const issues = validator.validateIdentifiers(resource as any, 'http://fhir.de/profile/PatientIn');
            expect(issues).toHaveLength(1); // Only the PKV one is invalid
            expect(issues[0].path).toBe('Patient.identifier[1].assigner.identifier.system');
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
