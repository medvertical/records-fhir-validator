/**
 * Extension Validator Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ExtensionValidator } from '../extension-validator';
import { getValueAtPath } from '../../core/validation-utils';
import type { StructureDefinition, ElementDefinition } from '../../core/structure-definition-types';

// Minimal mocks for required constructor deps
const mockSdLoader = { loadProfile: vi.fn() } as any;
const mockTypeValidator = { validate: vi.fn().mockResolvedValue([]) } as any;
const mockValueSetValidator = { validate: vi.fn().mockResolvedValue([]) } as any;
const mockElementRulesValidator = { validate: vi.fn().mockReturnValue([]) } as any;

describe('ExtensionValidator', () => {
  const validator = new ExtensionValidator(mockSdLoader, mockTypeValidator, mockValueSetValidator, mockElementRulesValidator);

  // Mock UK Core Patient profile with birthSex extension
  const mockUKCorePatientProfile: StructureDefinition = {
    resourceType: 'StructureDefinition',
    url: 'https://fhir.hl7.org.uk/StructureDefinition/UKCore-Patient',
    name: 'UKCorePatient',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        {
          id: 'Patient',
          path: 'Patient',
          min: 0,
          max: '*'
        },
        {
          id: 'Patient.extension:birthSex',
          path: 'Patient.extension',
          sliceName: 'birthSex',
          min: 0,
          max: '1',
          type: [{
            code: 'Extension',
            profile: ['https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex']
          }]
        } as ElementDefinition
      ]
    }
  };

  function makeContext(resource: any, profileSD: StructureDefinition) {
    return {
      resource,
      profileSD,
      strictMode: false,
      fhirVersion: 'R4' as const,
      profileUrl: profileSD.url,
      getValueAtPath: (res: any, path: string) => getValueAtPath(res, path),
    };
  }

  describe('validateExtensions', () => {
    it('should validate valid extension', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'test-patient',
        extension: [{
          url: 'https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex',
          valueCode: 'M'
        }]
      };

      const issues = await validator.validateExtensions(resource, mockUKCorePatientProfile, makeContext(resource, mockUKCorePatientProfile));

      // Should have no structural errors (URL/structure/cardinality)
      const structuralErrors = issues.filter(i =>
        i.severity === 'error' &&
        (i.code === 'profile-extension-url-missing' ||
         i.code === 'profile-extension-no-value' ||
         i.code === 'profile-extension-value-and-nested' ||
         i.code === 'profile-extension-min-cardinality' ||
         i.code === 'profile-extension-max-cardinality')
      );
      expect(structuralErrors).toHaveLength(0);
    });

    it('should detect extension without URL', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'test-patient',
        extension: [{
          // Missing url
          valueCode: 'M'
        }]
      };

      const issues = await validator.validateExtensions(resource, mockUKCorePatientProfile, makeContext(resource, mockUKCorePatientProfile));

      // Should have error about missing URL
      const urlErrors = issues.filter(i =>
        i.code === 'profile-extension-url-missing' && i.severity === 'error'
      );
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('should detect extension with both value and nested extensions', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'test-patient',
        extension: [{
          url: 'https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex',
          valueCode: 'M',
          extension: [{ url: 'nested', valueString: 'invalid' }]
        }]
      };

      const issues = await validator.validateExtensions(resource, mockUKCorePatientProfile, makeContext(resource, mockUKCorePatientProfile));

      // Should have error about both value and nested
      const bothErrors = issues.filter(i =>
        i.code === 'profile-extension-value-and-nested' && i.severity === 'error'
      );
      expect(bothErrors.length).toBeGreaterThan(0);
    });

    it('should detect extension without value or nested extensions', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'test-patient',
        extension: [{
          url: 'https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex'
          // Missing value and nested extensions
        }]
      };

      const issues = await validator.validateExtensions(resource, mockUKCorePatientProfile, makeContext(resource, mockUKCorePatientProfile));

      // Should have error about no value
      const noValueErrors = issues.filter(i =>
        i.code === 'profile-extension-no-value' && i.severity === 'error'
      );
      expect(noValueErrors.length).toBeGreaterThan(0);
    });

    it('should validate modifier extensions', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'test-patient',
        modifierExtension: [{
          url: 'http://example.org/fhir/StructureDefinition/modifier-ext',
          valueBoolean: true
        }]
      };

      const issues = await validator.validateExtensions(resource, mockUKCorePatientProfile, makeContext(resource, mockUKCorePatientProfile));

      // Should process without crashing
      expect(Array.isArray(issues)).toBe(true);
    });

    it('should check for required extensions', async () => {
      // Create profile with required extension
      const profileWithRequired: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            {
              id: 'Patient',
              path: 'Patient',
              min: 0,
              max: '*'
            },
            {
              id: 'Patient.extension:required',
              path: 'Patient.extension',
              sliceName: 'required',
              min: 1, // Required
              max: '1',
              type: [{
                code: 'Extension',
                profile: ['http://example.org/required-extension']
              }]
            } as ElementDefinition
          ]
        }
      };

      const resource = {
        resourceType: 'Patient',
        id: 'test-patient'
        // Missing required extension
      };

      const issues = await validator.validateExtensions(resource, profileWithRequired, makeContext(resource, profileWithRequired));

      // Should have error about missing required extension
      const requiredErrors = issues.filter(i =>
        i.code === 'profile-extension-min-cardinality' && i.severity === 'error'
      );
      expect(requiredErrors.length).toBeGreaterThan(0);
      expect(requiredErrors[0]).toMatchObject({
        resourceType: 'Patient',
        details: expect.objectContaining({ resourceType: 'Patient' }),
      });
    });

    it('matches required extension slices declared with versioned profile canonicals', async () => {
      const profileWithVersionedExtension: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/profile/patient-versioned-extension',
        name: 'PatientWithVersionedExtension',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        snapshot: {
          element: [
            { id: 'Patient', path: 'Patient', min: 0, max: '*' },
            {
              id: 'Patient.name.given.extension:qualifier',
              path: 'Patient.name.given.extension',
              sliceName: 'qualifier',
              min: 1,
              max: '1',
              type: [{
                code: 'Extension',
                profile: ['http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier|5.2.0'],
              }],
            } as ElementDefinition,
          ],
        },
      };
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        name: [{
          given: ['Hendrik'],
          _given: [{
            extension: [{
              url: 'http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier',
              valueCode: 'BR',
            }],
          }],
        }],
      };

      const issues = await validator.validateExtensions(
        resource,
        profileWithVersionedExtension,
        makeContext(resource, profileWithVersionedExtension),
      );

      expect(issues.filter(i => i.code === 'profile-extension-min-cardinality')).toHaveLength(0);
    });

    it('should validate extension cardinality', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'test-patient',
        extension: [
          {
            url: 'https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex',
            valueCode: 'M'
          },
          {
            url: 'https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-BirthSex',
            valueCode: 'F'
          }
        ]
      };

      const issues = await validator.validateExtensions(resource, mockUKCorePatientProfile, makeContext(resource, mockUKCorePatientProfile));

      // Should have error about max cardinality (max=1)
      const cardinalityErrors = issues.filter(i =>
        i.code === 'profile-extension-max-cardinality' && i.severity === 'error'
      );
      expect(cardinalityErrors.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Deep nested extension validation (PRD §6.1 "Deep Extension Validation")
  // ==========================================================================

  describe('deep nested extension validation', () => {
    const PARENT_URL = 'http://example.org/ext/complex-parent';

    // Parent extension profile with two sub-extension slices:
    //   - required: min=1 max=1
    //   - optional: min=0 max=*
    const parentProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: PARENT_URL,
      name: 'ComplexParent',
      status: 'active',
      kind: 'complex-type',
      abstract: false,
      type: 'Extension',
      snapshot: {
        element: [
          {
            id: 'Extension',
            path: 'Extension',
            min: 0,
            max: '*',
          } as ElementDefinition,
          {
            id: 'Extension.extension:required',
            path: 'Extension.extension',
            sliceName: 'required',
            min: 1,
            max: '1',
            type: [{ code: 'Extension' }],
            fixedUri: 'required-sub',
          } as unknown as ElementDefinition,
          {
            id: 'Extension.extension:optional',
            path: 'Extension.extension',
            sliceName: 'optional',
            min: 0,
            max: '*',
            type: [{ code: 'Extension' }],
            fixedUri: 'optional-sub',
          } as unknown as ElementDefinition,
        ],
      },
    };

    // Host Patient profile declaring the parent extension
    const patientProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/profile/patient',
      name: 'DeepExtPatient',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          { id: 'Patient', path: 'Patient', min: 0, max: '*' },
          {
            id: 'Patient.extension:complex',
            path: 'Patient.extension',
            sliceName: 'complex',
            min: 0,
            max: '1',
            type: [
              {
                code: 'Extension',
                profile: [PARENT_URL],
              },
            ],
          } as ElementDefinition,
        ],
      },
    };

    function makeDeepValidator() {
      const sdLoader = {
        loadProfile: vi.fn(async (url: string) => {
          if (url === PARENT_URL) return parentProfile;
          return null;
        }),
      } as any;
      const typeValidator = { validate: vi.fn().mockResolvedValue([]) } as any;
      const valueSetValidator = {
        validate: vi.fn().mockResolvedValue([]),
        validateBinding: vi.fn().mockResolvedValue([]),
      } as any;
      const elementRulesValidator = { validate: vi.fn().mockReturnValue([]) } as any;
      return new ExtensionValidator(
        sdLoader,
        typeValidator,
        valueSetValidator,
        elementRulesValidator,
      );
    }

    it('reports a missing required sub-extension', async () => {
      const validator = makeDeepValidator();
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: PARENT_URL,
            extension: [
              { url: 'optional-sub', valueString: 'hello' },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const minErrors = issues.filter(
        i => i.code === 'profile-extension-min-cardinality',
      );
      expect(minErrors.length).toBeGreaterThan(0);
    });

    it('accepts a valid nested extension tree', async () => {
      const validator = makeDeepValidator();
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: PARENT_URL,
            extension: [
              { url: 'required-sub', valueString: 'ok' },
              { url: 'optional-sub', valueString: 'also-ok' },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const minErrors = issues.filter(
        i => i.code === 'profile-extension-min-cardinality',
      );
      expect(minErrors.length).toBe(0);
    });

    it('reports max-cardinality violation on a required singleton sub-extension', async () => {
      const validator = makeDeepValidator();
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: PARENT_URL,
            extension: [
              { url: 'required-sub', valueString: 'a' },
              { url: 'required-sub', valueString: 'b' },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const maxErrors = issues.filter(
        i => i.code === 'profile-extension-max-cardinality',
      );
      expect(maxErrors.length).toBeGreaterThan(0);
    });

    it('stops recursing when nesting exceeds the depth limit', async () => {
      const validator = makeDeepValidator();

      // Build a 10-deep chain
      let chain: any = { url: 'required-sub', valueString: 'leaf' };
      for (let i = 0; i < 10; i++) {
        chain = { url: PARENT_URL, extension: [chain] };
      }
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [chain],
      };

      const issues = await validator.validateExtensions(
        resource,
        patientProfile,
        makeContext(resource, patientProfile),
      );

      const depthErrors = issues.filter(i => i.code === 'profile-extension-max-depth');
      expect(depthErrors.length).toBeGreaterThan(0);
    });
  });

  describe('known HL7 narrative-IG extensions (textLink / narrativeLink)', () => {
    const minimalPatientProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Patient',
      name: 'Patient',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '*' } as ElementDefinition] },
    };

    it('does not flag textLink as profile-extension-not-found', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/textLink',
            extension: [
              { url: 'htmlid', valueString: 'a' },
              { url: 'data', valueUri: '#a' },
            ],
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-not-found')).toHaveLength(0);
    });

    it('does not flag quantity translation as profile-extension-not-found', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/extension-quantity-translation',
            valueString: 'translation',
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-not-found')).toHaveLength(0);
    });

    it('does not flag R5 rendered dosage instruction backport extensions as not found', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/5.0/StructureDefinition/extension-MedicationRequest.renderedDosageInstruction',
            valueMarkdown: 'Take as directed',
          },
          {
            url: 'http://hl7.org/fhir/5.0/StructureDefinition/extension-MedicationStatement.renderedDosageInstruction',
            valueMarkdown: 'Taken as directed',
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-not-found')).toHaveLength(0);
    });

    it('does not flag the R5 planned start date backport extension as not found', async () => {
      const resource = {
        resourceType: 'Encounter',
        id: 'enc1',
        extension: [
          {
            url: 'http://hl7.org/fhir/5.0/StructureDefinition/extension-Encounter.plannedStartDate',
            valueDateTime: '2026-05-23T10:00:00+02:00',
          },
        ],
      };
      const encounterProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/StructureDefinition/Encounter',
        name: 'Encounter',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Encounter',
        snapshot: { element: [{ id: 'Encounter', path: 'Encounter', min: 0, max: '*' } as ElementDefinition] },
      };

      const issues = await validator.validateExtensions(
        resource, encounterProfile, makeContext(resource, encounterProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-not-found')).toHaveLength(0);
    });

    it('does not flag known HL7 extensions IG canonicals as not found', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/individual-genderIdentity',
            valueCodeableConcept: { text: 'nonbinary' },
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/individual-pronouns',
            valueCodeableConcept: { text: 'they/them' },
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/patient-occupation',
            valueCodeableConcept: { text: 'engineer' },
          },
          {
            url: 'http://hl7.org/fhir/StructureDefinition/instance-name',
            valueString: 'Example name',
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-not-found')).toHaveLength(0);
    });

    it('flags narrativeLink with valueUri instead of valueUrl', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/narrativeLink',
            valueUri: 'http://example.org/some#thing',
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      const wrong = issues.filter(i => i.code === 'profile-extension-wrong-value-type');
      expect(wrong).toHaveLength(1);
      expect(wrong[0].severity).toBe('error');
      expect(wrong[0].message).toContain('allows for the types [url] but found type uri');
    });

    it('accepts narrativeLink with the correct valueUrl type', async () => {
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/narrativeLink',
            valueUrl: 'http://example.org/some#thing',
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-wrong-value-type')).toHaveLength(0);
    });

    it('does not run the type check for the misspelled NarrativeLink (capital N)', async () => {
      // The capital-N URL is treated as known so the entry-recursion pass
      // doesn't double-emit `extension-not-found`, but the type table only
      // covers the canonical lowercase form — so the wrong-value-type
      // check stays quiet here.
      const resource = {
        resourceType: 'Patient',
        id: 'p1',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/NarrativeLink',
            valueUri: 'http://example.org/some#thing',
          },
        ],
      };

      const issues = await validator.validateExtensions(
        resource, minimalPatientProfile, makeContext(resource, minimalPatientProfile),
      );
      expect(issues.filter(i => i.code === 'profile-extension-wrong-value-type')).toHaveLength(0);
    });
  });
});
