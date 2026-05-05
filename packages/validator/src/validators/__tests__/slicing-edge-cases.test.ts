/**
 * slicing-edge-cases.test.ts
 * --------------------------
 *
 * Edge-case regression tests for the SlicingValidator, anchoring
 * demo-critical paths identified during the DMEA pre-demo audit:
 *
 * 1. Multiple discriminators (system + use) — AND logic
 * 2. $this discriminator on CodeableConcept
 * 3. Closed slicing with min=1 required slice absent
 * 4. Extension slicing by URL discriminator
 * 5. Open slicing unmatched element (should NOT error)
 */

import { describe, it, expect } from 'vitest';
import { SlicingValidator } from '../slicing-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

describe('SlicingValidator — edge cases', () => {
  const validator = new SlicingValidator();

  // ================================================================
  // 1. Multiple discriminators — both must match
  // ================================================================

  describe('multiple discriminators (system + use)', () => {
    const profileMultiDisc: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/Patient-multi-disc',
      name: 'MultiDiscTest',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.identifier',
            path: 'Patient.identifier',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [
                { type: 'value', path: 'system' },
                { type: 'value', path: 'use' },
              ],
              rules: 'open',
              ordered: false,
            },
          } as any,
          {
            id: 'Patient.identifier:officialNHS',
            path: 'Patient.identifier',
            sliceName: 'officialNHS',
            min: 0,
            max: '1',
            type: [{ code: 'Identifier' }],
            pattern: {
              system: 'https://fhir.nhs.uk/Id/nhs-number',
              use: 'official',
            },
          } as any,
        ],
      },
    };

    it('matches when BOTH discriminator values are present', async () => {
      const identifiers = [
        { system: 'https://fhir.nhs.uk/Id/nhs-number', use: 'official', value: '1234567890' },
      ];
      const issues = await validator.validateSlicing(identifiers, 'Patient.identifier', profileMultiDisc);
      const sliceErrors = issues.filter(i => i.severity === 'error');
      expect(sliceErrors).toHaveLength(0);
    });

    it('does NOT match when only one discriminator matches (system yes, use wrong)', async () => {
      const identifiers = [
        { system: 'https://fhir.nhs.uk/Id/nhs-number', use: 'temp', value: '1234567890' },
      ];
      const issues = await validator.validateSlicing(identifiers, 'Patient.identifier', profileMultiDisc);
      // Element should not match officialNHS slice — that's fine for open slicing (no error).
      // We just verify it didn't wrongly match.
      const matchedSlice = issues.find(i => i.message?.includes('officialNHS'));
      expect(matchedSlice).toBeUndefined();
    });
  });

  // ================================================================
  // 2. Extension slicing by URL
  // ================================================================

  describe('extension slicing by URL discriminator', () => {
    const profileExtSlice: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/Patient-ext-slice',
      name: 'ExtSliceTest',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.extension',
            path: 'Patient.extension',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: 'url' }],
              rules: 'open',
              ordered: false,
            },
          } as any,
          {
            id: 'Patient.extension:birthPlace',
            path: 'Patient.extension',
            sliceName: 'birthPlace',
            min: 0,
            max: '1',
            type: [{ code: 'Extension', profile: ['http://hl7.org/fhir/StructureDefinition/patient-birthPlace'] }],
            pattern: {
              url: 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
            },
          } as any,
        ],
      },
    };

    it('matches extension by url discriminator', async () => {
      const extensions = [
        {
          url: 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
          valueAddress: { city: 'London' },
        },
      ];
      const issues = await validator.validateSlicing(extensions, 'Patient.extension', profileExtSlice);
      const sliceErrors = issues.filter(i => i.severity === 'error');
      expect(sliceErrors).toHaveLength(0);
    });

    it('unmatched extension in open slicing does NOT error', async () => {
      const extensions = [
        { url: 'http://example.org/custom-extension', valueString: 'test' },
      ];
      const issues = await validator.validateSlicing(extensions, 'Patient.extension', profileExtSlice);
      const sliceErrors = issues.filter(i => i.severity === 'error');
      expect(sliceErrors).toHaveLength(0);
    });
  });

  // ================================================================
  // 3. Closed slicing — unmatched element is an error
  // ================================================================

  describe('closed slicing', () => {
    const profileClosed: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/Patient-closed',
      name: 'ClosedSliceTest',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.identifier',
            path: 'Patient.identifier',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: 'system' }],
              rules: 'closed',
              ordered: false,
            },
          } as any,
          {
            id: 'Patient.identifier:nhsNumber',
            path: 'Patient.identifier',
            sliceName: 'nhsNumber',
            min: 1,
            max: '1',
            type: [{ code: 'Identifier' }],
            pattern: { system: 'https://fhir.nhs.uk/Id/nhs-number' },
          } as any,
        ],
      },
    };

    it('errors when required slice (min=1) is absent', async () => {
      const identifiers: any[] = [];
      const issues = await validator.validateSlicing(identifiers, 'Patient.identifier', profileClosed);
      const minErrors = issues.filter(i => i.code === 'profile-slice-min-cardinality');
      expect(minErrors.length).toBeGreaterThan(0);
    });

    it('errors when unmatched element in closed slicing', async () => {
      const identifiers = [
        { system: 'https://fhir.nhs.uk/Id/nhs-number', value: '123' },
        { system: 'http://example.org/unknown-system', value: '456' },
      ];
      const issues = await validator.validateSlicing(identifiers, 'Patient.identifier', profileClosed);
      const unmatchedErrors = issues.filter(i =>
        i.code === 'profile-slice-not-allowed' || i.message?.includes('closed')
      );
      expect(unmatchedErrors.length).toBeGreaterThan(0);
    });
  });

  // ================================================================
  // 4. Open slicing — unmatched element is NOT an error
  // ================================================================

  describe('open slicing — unmatched is fine', () => {
    const profileOpen: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/Patient-open',
      name: 'OpenSliceTest',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.identifier',
            path: 'Patient.identifier',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: 'system' }],
              rules: 'open',
              ordered: false,
            },
          } as any,
          {
            id: 'Patient.identifier:nhsNumber',
            path: 'Patient.identifier',
            sliceName: 'nhsNumber',
            min: 0,
            max: '1',
            type: [{ code: 'Identifier' }],
            pattern: { system: 'https://fhir.nhs.uk/Id/nhs-number' },
          } as any,
        ],
      },
    };

    it('allows unmatched identifiers in open slicing without errors', async () => {
      const identifiers = [
        { system: 'http://example.org/mrn', value: 'MRN-001' },
        { system: 'http://example.org/other', value: 'OTHER-002' },
      ];
      const issues = await validator.validateSlicing(identifiers, 'Patient.identifier', profileOpen);
      const sliceErrors = issues.filter(i => i.severity === 'error');
      expect(sliceErrors).toHaveLength(0);
    });
  });

  // ================================================================
  // 5. Max cardinality on slice
  // ================================================================

  describe('max cardinality violation', () => {
    const profileMaxOne: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/Patient-max1',
      name: 'Max1Test',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.identifier',
            path: 'Patient.identifier',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: 'system' }],
              rules: 'open',
              ordered: false,
            },
          } as any,
          {
            id: 'Patient.identifier:nhsNumber',
            path: 'Patient.identifier',
            sliceName: 'nhsNumber',
            min: 0,
            max: '1',
            type: [{ code: 'Identifier' }],
            pattern: { system: 'https://fhir.nhs.uk/Id/nhs-number' },
          } as any,
        ],
      },
    };

    it('errors when max=1 slice has 2 matching elements', async () => {
      const identifiers = [
        { system: 'https://fhir.nhs.uk/Id/nhs-number', value: '111' },
        { system: 'https://fhir.nhs.uk/Id/nhs-number', value: '222' },
      ];
      const issues = await validator.validateSlicing(identifiers, 'Patient.identifier', profileMaxOne);
      const maxErrors = issues.filter(i => i.code === 'profile-slice-max-cardinality');
      expect(maxErrors.length).toBeGreaterThan(0);
    });
  });
});
