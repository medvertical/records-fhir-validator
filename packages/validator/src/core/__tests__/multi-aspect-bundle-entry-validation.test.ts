import { describe, it, expect, vi } from 'vitest';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import { loadProfileOrBase } from '../profile-loader-utils';
import type { ValidationIssue } from '../../types';

vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: vi.fn().mockImplementation(async (_sdLoader, _snapshotGenerator, profileUrl, resourceType) => ({
    structureDef: {
      id: resourceType,
      url: profileUrl,
      ...(resourceType === 'Bundle'
        ? {
          version: '1.0.0-test',
          baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Bundle',
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-imposeProfile',
            valueCanonical: 'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips',
          }],
        }
        : {}),
      resourceType: 'StructureDefinition',
      snapshot: {
        element: resourceType === 'Composition'
          ? [
              {
                path: 'Composition.section.entry',
                type: [{
                  code: 'Reference',
                  targetProfile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
                }],
              },
            ]
          : [],
      },
    },
    declaredProfileUrl: profileUrl,
    usedBaseFallback: false,
  })),
  createProfileFallbackIssue: vi.fn(),
}));

vi.mock('../validators/deep-profile-validator', () => ({
  deepProfileValidator: { validate: () => [] },
}));
vi.mock('../validators/deep-binding-validator', () => ({
  deepBindingValidator: { validate: () => [] },
}));
vi.mock('../validators/sd-fhirpath-executor', () => ({
  sdFHIRPathExecutor: { execute: async () => [] },
}));
vi.mock('../validators/contained-resource-validator', () => ({
  containedResourceValidator: { validate: () => [] },
}));
vi.mock('../validators/universal-constraints-validator', () => ({
  universalConstraintsValidator: { validate: () => [] },
}));
vi.mock('../validators/terminology-resource-validator', () => ({
  terminologyResourceValidator: { validate: () => [] },
}));

const observationIssue: ValidationIssue = {
  aspect: 'structural',
  severity: 'error',
  code: 'structural-cardinality-min',
  message: 'Observation.status: minimum cardinality 1 not met',
  path: 'Observation.status',
  expression: 'Observation.status',
};

const compositionIssue: ValidationIssue = {
  aspect: 'structural',
  severity: 'error',
  code: 'structural-cardinality-min',
  message: 'Composition.status: minimum cardinality 1 not met',
  path: 'Composition.status',
  expression: 'Composition.status',
};

const displayMismatchIssue: ValidationIssue = {
  aspect: 'terminology',
  severity: 'error',
  code: 'terminology-display-mismatch',
  message: "Wrong Display Name 'Urine leukocyte test' for http://snomed.info/sct#394712000",
  path: 'Observation.valueCodeableConcept.coding[0].display',
  expression: 'Observation.valueCodeableConcept.coding[0].display',
};

function makeDeps(options: {
  structuralIssueForObservation?: boolean;
  structuralIssueForComposition?: boolean;
  terminologyIssueForObservation?: boolean;
} = {}) {
  const {
    structuralIssueForObservation = true,
    structuralIssueForComposition = false,
    terminologyIssueForObservation = false,
  } = options;
  return {
    sdLoader: {} as any,
    snapshotGenerator: {} as any,
    structuralExecutor: {
      validate: async (ctx: { resourceType: string }) => {
        if (structuralIssueForObservation && ctx.resourceType === 'Observation') {
          return [{ ...observationIssue }];
        }
        if (structuralIssueForComposition && ctx.resourceType === 'Composition') {
          return [{ ...compositionIssue }];
        }
        return [];
      },
    } as any,
    profileExecutor: { validate: async () => [] } as any,
    terminologyExecutor: {
      validate: async (ctx: { resource: { resourceType?: string } }) =>
        terminologyIssueForObservation && ctx.resource.resourceType === 'Observation'
          ? [{ ...displayMismatchIssue }]
          : [],
    } as any,
    referenceExecutor: { validate: async () => [] } as any,
    invariantExecutor: { validate: async () => [] } as any,
    customRuleExecutor: { validate: async () => [] } as any,
    metadataExecutor: { validate: async () => [] } as any,
    bestPracticeValidator: { validate: () => [] } as any,
    strictMode: false,
  };
}

describe('multi-aspect-validate-callback — Bundle entry resources', () => {
  it('validates embedded entry resources and rewrites their issue paths under the parent Bundle', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'bundle-1',
        type: 'document',
        entry: [
          {
            fullUrl: 'urn:uuid:obs-1',
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
              meta: {
                profile: ['http://example.org/fhir/StructureDefinition/observation-eps'],
              },
            },
          },
        ],
      },
      'http://hl7.org/fhir/StructureDefinition/Bundle',
      'R4',
    );

    const structural = result.aspects.find(aspect => aspect.aspect === 'structural');
    expect(structural?.issues).toHaveLength(1);
    expect(structural?.issues[0].path).toBe(
      'Bundle.entry[0].resource/*Observation/obs-1*/.status',
    );
    expect(structural?.issues[0].expression).toBe(
      'Bundle.entry[0].resource/*Observation/obs-1*/.status',
    );
    expect(result.isValid).toBe(false);
    expect(loadProfileOrBase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'http://example.org/fhir/StructureDefinition/observation-eps',
      'Observation',
      'R4',
      undefined,
      undefined,
    );
  });

  it('adds document-context targetProfile issues when a Composition section reference points at an invalid embedded profile resource', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps({
        structuralIssueForObservation: false,
        terminologyIssueForObservation: true,
      }),
      ['profile', 'terminology'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'bundle-1',
        type: 'document',
        meta: {
          profile: ['http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'],
        },
        entry: [
          {
            fullUrl: 'urn:uuid:comp-1',
            resource: {
              resourceType: 'Composition',
              id: 'comp-1',
              meta: {
                profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
              },
              section: [
                {
                  entry: [{ reference: 'urn:uuid:obs-1' }],
                },
              ],
            },
          },
          {
            fullUrl: 'urn:uuid:obs-1',
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
              meta: {
                profile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
              },
              valueCodeableConcept: {
                coding: [
                  {
                    system: 'http://snomed.info/sct',
                    code: '394712000',
                    display: 'Urine leukocyte test',
                  },
                ],
              },
            },
          },
        ],
      },
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
    );

    const terminology = result.aspects.find(aspect => aspect.aspect === 'terminology');
    expect(terminology?.issues.map(issue => issue.path)).toContain(
      'Bundle.entry[1].resource/*Observation/obs-1*/.valueCodeableConcept.coding[0].display',
    );

    const profile = result.aspects.find(aspect => aspect.aspect === 'profile');
    expect(profile?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-constraint-violation',
        path: 'Bundle.entry[0].resource/*Composition/comp-1*/.section[0].entry[0]',
        message: 'Unable to find a profile match for urn:uuid:obs-1 among choices: http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core',
      }),
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        path: 'Bundle',
        message: "Slice 'Bundle.entry:composition': a matching slice is required, but not found (from http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps|1.0.0-test)",
      }),
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        path: 'Bundle',
        message: "Slice 'Bundle.entry:composition': a matching slice is required, but not found (from http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips)",
      }),
    ]));
    expect(result.isValid).toBe(false);
  });

  it('guards ART-DECOR document parity for multiple targetProfile failures and imposed Bundle parents', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps({
        structuralIssueForObservation: false,
        terminologyIssueForObservation: true,
      }),
      ['profile', 'terminology'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'art-decor-targetprofile-regression',
        type: 'document',
        meta: {
          profile: ['http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'],
        },
        entry: [
          {
            fullUrl: 'urn:uuid:comp-1',
            resource: {
              resourceType: 'Composition',
              id: 'comp-1',
              meta: {
                profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
              },
              section: [
                {
                  entry: [
                    { reference: 'urn:uuid:obs-1' },
                    { reference: 'urn:uuid:obs-2' },
                  ],
                },
              ],
            },
          },
          {
            fullUrl: 'urn:uuid:obs-1',
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
              meta: {
                profile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
              },
              valueCodeableConcept: {
                coding: [{
                  system: 'http://snomed.info/sct',
                  code: '394712000',
                  display: 'Urine leukocyte test',
                }],
              },
            },
          },
          {
            fullUrl: 'urn:uuid:obs-2',
            resource: {
              resourceType: 'Observation',
              id: 'obs-2',
              meta: {
                profile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
              },
              valueCodeableConcept: {
                coding: [{
                  system: 'http://snomed.info/sct',
                  code: '314137006',
                  display: 'Urine microscopy: no casts',
                }],
              },
            },
          },
        ],
      },
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
    );

    const profileIssues = result.aspects.find(aspect => aspect.aspect === 'profile')?.issues ?? [];
    const targetProfileIssues = profileIssues.filter(issue =>
      issue.ruleId === 'profile-targetprofile-match-failed'
    );
    const bundleCompositionSliceIssues = profileIssues.filter(issue =>
      issue.ruleId === 'slice-min-composition-conformance'
    );

    expect(targetProfileIssues).toHaveLength(2);
    expect(targetProfileIssues.map(issue => issue.path)).toEqual([
      'Bundle.entry[0].resource/*Composition/comp-1*/.section[0].entry[0]',
      'Bundle.entry[0].resource/*Composition/comp-1*/.section[0].entry[1]',
    ]);
    expect(bundleCompositionSliceIssues).toHaveLength(2);
    expect(bundleCompositionSliceIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        path: 'Bundle',
        message: "Slice 'Bundle.entry:composition': a matching slice is required, but not found (from http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps|1.0.0-test)",
        details: expect.objectContaining({
          sourceProfile: 'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
        }),
      }),
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        path: 'Bundle',
        message: "Slice 'Bundle.entry:composition': a matching slice is required, but not found (from http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips)",
        details: expect.objectContaining({
          sourceProfile: 'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips',
        }),
      }),
    ]));
  });

  it('treats structural child conformance errors as Composition targetProfile match failures', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps({
        structuralIssueForObservation: true,
        terminologyIssueForObservation: false,
      }),
      ['structural', 'profile'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'bundle-structural-gap',
        type: 'document',
        meta: {
          profile: ['http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'],
        },
        entry: [
          {
            fullUrl: 'urn:uuid:comp-1',
            resource: {
              resourceType: 'Composition',
              id: 'comp-1',
              meta: {
                profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
              },
              section: [
                {
                  entry: [{ reference: 'urn:uuid:obs-1' }],
                },
              ],
            },
          },
          {
            fullUrl: 'urn:uuid:obs-1',
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
              meta: {
                profile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
              },
            },
          },
        ],
      },
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
    );

    const profile = result.aspects.find(aspect => aspect.aspect === 'profile');
    expect(profile?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-constraint-violation',
        path: 'Bundle.entry[0].resource/*Composition/comp-1*/.section[0].entry[0]',
        message: 'Unable to find a profile match for urn:uuid:obs-1 among choices: http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core',
      }),
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        path: 'Bundle',
      }),
    ]));
    expect(result.isValid).toBe(false);
  });

  it('uses Composition targetProfile choices when the referenced resource does not declare meta.profile', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps({
        structuralIssueForObservation: true,
        terminologyIssueForObservation: false,
      }),
      ['structural', 'profile'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'bundle-target-choice',
        type: 'document',
        entry: [
          {
            fullUrl: 'urn:uuid:comp-1',
            resource: {
              resourceType: 'Composition',
              id: 'comp-1',
              meta: {
                profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
              },
              section: [
                {
                  entry: [{ reference: 'urn:uuid:obs-1' }],
                },
              ],
            },
          },
          {
            fullUrl: 'urn:uuid:obs-1',
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
            },
          },
        ],
      },
      'http://hl7.org/fhir/StructureDefinition/Bundle',
      'R4',
    );

    const profile = result.aspects.find(aspect => aspect.aspect === 'profile');
    expect(profile?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-constraint-violation',
        path: 'Bundle.entry[0].resource/*Composition/comp-1*/.section[0].entry[0]',
        message: 'Unable to find a profile match for urn:uuid:obs-1 among choices: http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core',
      }),
    ]));
  });

  it('narrows targetProfile choices to the matched Composition section slice', async () => {
    vi.mocked(loadProfileOrBase).mockImplementation(async (_sdLoader, _snapshotGenerator, profileUrl, resourceType) => ({
      structureDef: {
        id: resourceType,
        url: profileUrl,
        resourceType: 'StructureDefinition',
        snapshot: {
          element: resourceType === 'Composition'
            ? [
                {
                  id: 'Composition.section:sectionAllergies',
                  path: 'Composition.section',
                  sliceName: 'sectionAllergies',
                },
                {
                  id: 'Composition.section:sectionAllergies.code',
                  path: 'Composition.section.code',
                  patternCodeableConcept: {
                    coding: [{ system: 'http://loinc.org', code: '48765-2' }],
                  },
                },
                {
                  id: 'Composition.section:sectionAllergies.entry:allergyOrIntolerance',
                  path: 'Composition.section.entry',
                  sliceName: 'allergyOrIntolerance',
                  type: [{
                    code: 'Reference',
                    targetProfile: ['http://hl7.eu/fhir/base/StructureDefinition/allergyIntolerance-eu-core'],
                  }],
                },
                {
                  id: 'Composition.section:sectionResults',
                  path: 'Composition.section',
                  sliceName: 'sectionResults',
                },
                {
                  id: 'Composition.section:sectionResults.code',
                  path: 'Composition.section.code',
                  patternCodeableConcept: {
                    coding: [{ system: 'http://loinc.org', code: '30954-2' }],
                  },
                },
                {
                  id: 'Composition.section:sectionResults.entry:results-medicalTestResult',
                  path: 'Composition.section.entry',
                  sliceName: 'results-medicalTestResult',
                  type: [{
                    code: 'Reference',
                    targetProfile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
                  }],
                },
              ]
            : [],
        },
      },
      declaredProfileUrl: profileUrl,
      usedBaseFallback: false,
    }));

    const callback = buildMultiAspectValidateCallback(
      makeDeps({
        structuralIssueForObservation: true,
        terminologyIssueForObservation: false,
      }),
      ['structural', 'profile'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'bundle-section-choice',
        type: 'document',
        entry: [
          {
            fullUrl: 'urn:uuid:comp-1',
            resource: {
              resourceType: 'Composition',
              id: 'comp-1',
              meta: {
                profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
              },
              section: [
                {
                  code: {
                    coding: [{ system: 'http://loinc.org', code: '30954-2' }],
                  },
                  entry: [{ reference: 'urn:uuid:obs-1' }],
                },
              ],
            },
          },
          {
            fullUrl: 'urn:uuid:obs-1',
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
            },
          },
        ],
      },
      'http://hl7.org/fhir/StructureDefinition/Bundle',
      'R4',
    );

    const profile = result.aspects.find(aspect => aspect.aspect === 'profile');
    expect(profile?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-constraint-violation',
        path: 'Bundle.entry[0].resource/*Composition/comp-1*/.section[0].entry[0]',
        message: 'Unable to find a profile match for urn:uuid:obs-1 among choices: http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core',
      }),
    ]));
    expect(profile?.issues.map(issue => issue.message).join('\n')).not.toContain(
      'http://hl7.eu/fhir/base/StructureDefinition/allergyIntolerance-eu-core',
    );
  });

  it('treats required Bundle.entry slice candidates with child errors as missing conformance matches', async () => {
    vi.mocked(loadProfileOrBase).mockImplementation(async (_sdLoader, _snapshotGenerator, profileUrl, resourceType) => ({
      structureDef: {
        id: resourceType,
        url: profileUrl,
        resourceType: 'StructureDefinition',
        snapshot: {
          element: resourceType === 'Bundle'
            ? [
                {
                  id: 'Bundle.entry',
                  path: 'Bundle.entry',
                  min: 1,
                  max: '*',
                  slicing: {
                    discriminator: [
                      { type: 'type', path: 'resource' },
                      { type: 'profile', path: 'resource' },
                    ],
                    rules: 'open',
                  },
                },
                {
                  id: 'Bundle.entry:composition',
                  path: 'Bundle.entry',
                  sliceName: 'composition',
                  min: 1,
                  max: '1',
                },
                {
                  id: 'Bundle.entry:composition.resource',
                  path: 'Bundle.entry.resource',
                  min: 1,
                  max: '1',
                  type: [{
                    code: 'Composition',
                    profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
                  }],
                },
              ]
            : [],
        },
      },
      declaredProfileUrl: profileUrl,
      usedBaseFallback: false,
    }));

    const callback = buildMultiAspectValidateCallback(
      makeDeps({
        structuralIssueForObservation: false,
        structuralIssueForComposition: true,
      }),
      ['structural', 'profile'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      {
        resourceType: 'Bundle',
        id: 'bundle-entry-slice',
        type: 'document',
        meta: {
          profile: ['http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'],
        },
        entry: [
          {
            fullUrl: 'urn:uuid:comp-1',
            resource: {
              resourceType: 'Composition',
              id: 'comp-1',
              meta: {
                profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
              },
            },
          },
        ],
      },
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
    );

    const profile = result.aspects.find(aspect => aspect.aspect === 'profile');
    expect(profile?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-constraint-violation',
        ruleId: 'bundle-entry-slice-profile-match-failed',
        path: 'Bundle.entry[0].resource/*Composition/comp-1*/',
      }),
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        ruleId: 'bundle-entry-slice-min-composition-conformance',
        path: 'Bundle.entry',
      }),
    ]));
  });
});
