
import { describe, it, expect, beforeAll } from 'vitest';
import { StructuralExecutor } from '../executors/structural-executor';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import { getValueAtPath } from '../validation-utils';

/**
 * Mocks and Setup
 */
const mockSdLoader = {
    loadProfile: async () => ({
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/TestPatient',
        snapshot: {
            element: [
                {
                    path: 'Patient',
                    min: 0,
                    max: '*'
                },
                {
                    path: 'Patient.identifier',
                    min: 0,
                    max: '*',
                    mustSupport: true
                }
            ]
        }
    })
} as unknown as StructureDefinitionLoader;

describe('MustSupport Strictness', () => {
    let executor: StructuralExecutor;

    beforeAll(() => {
        executor = new StructuralExecutor(mockSdLoader);
    });

    it('should report warning by default (standard strictness)', async () => {
        const resource = {
            resourceType: 'Patient',
            id: 'test'
            // Missing identifier
        };

        const issues = await executor.validate(resource, {
            resource,
            resourceType: 'Patient',
            structureDef: await mockSdLoader.loadProfile(''),
            fhirVersion: 'R4',
            getValueAtPath,
            settings: {
                validationStrictness: 'standard'
            }
        });

        const mustSupportIssue = issues.find(i => i.code === 'profile-mustsupport-missing');
        expect(mustSupportIssue).toBeDefined();
    });

    it('should report warning for strict strictness', async () => {
        const resource = {
            resourceType: 'Patient',
            id: 'test'
        };

        const issues = await executor.validate(resource, {
            resource,
            resourceType: 'Patient',
            structureDef: await mockSdLoader.loadProfile(''),
            fhirVersion: 'R4',
            getValueAtPath,
            settings: {
                validationStrictness: 'strict'
            }
        });

        const mustSupportIssue = issues.find(i => i.code === 'profile-mustsupport-missing');
        expect(mustSupportIssue).toBeDefined();
    });

    it('should report info for compatibility strictness', async () => {
        const resource = {
            resourceType: 'Patient',
            id: 'test'
        };

        const issues = await executor.validate(resource, {
            resource,
            resourceType: 'Patient',
            structureDef: await mockSdLoader.loadProfile(''),
            fhirVersion: 'R4',
            getValueAtPath,
            settings: {
                validationStrictness: 'compatibility'
            }
        });

        const mustSupportIssue = issues.find(i => i.code === 'profile-mustsupport-missing');
        expect(mustSupportIssue).toBeDefined();
    });

    it('should default to warning if no settings provided', async () => {
        const resource = {
            resourceType: 'Patient',
            id: 'test'
        };

        const issues = await executor.validate(resource, {
            resource,
            resourceType: 'Patient',
            structureDef: await mockSdLoader.loadProfile(''),
            fhirVersion: 'R4',
            getValueAtPath
            // No settings
        });

        const mustSupportIssue = issues.find(i => i.code === 'profile-mustsupport-missing');
        expect(mustSupportIssue).toBeDefined();
    });

    it('applies contextual MustSupport skips on the direct snapshot path', async () => {
        const resource = {
            resourceType: 'Encounter',
            id: 'ambulatory',
            status: 'finished',
            class: {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
                code: 'AMB'
            }
        };
        const structureDef = {
            resourceType: 'StructureDefinition',
            url: 'http://example.org/StructureDefinition/TestEncounter',
            snapshot: {
                element: [
                    { path: 'Encounter' },
                    { path: 'Encounter.hospitalization', min: 0, max: '1', mustSupport: true }
                ]
            }
        };

        const issues = await executor.validate(resource, {
            resource,
            resourceType: 'Encounter',
            structureDef,
            fhirVersion: 'R4',
            getValueAtPath,
            settings: {
                validationStrictness: 'standard'
            }
        });

        expect(issues).not.toContainEqual(expect.objectContaining({
            code: 'profile-mustsupport-missing',
            path: 'Encounter.hospitalization'
        }));
    });
});
