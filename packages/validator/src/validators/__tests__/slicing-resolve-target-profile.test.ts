import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';

import metadata from '../__fixtures__/slicing-resolved-code-mii-patho-metadata.json';

const GROUPER = 'http://example.org/StructureDefinition/diagnostic-conclusion-grouper';
const MACRO = 'http://example.org/StructureDefinition/macroscopic-grouper';
const ELEMENT_PATH = 'DiagnosticReport.result';

/**
 * Synthetic Reference availability controls use the original target code
 * metadata. Genuine, unmodified Patho slice definitions have their own suite.
 */
function targetProfileOnlyProfile(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/patho-report',
    name: 'PathoReport',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'DiagnosticReport',
    snapshot: {
      element: [
        {
          id: ELEMENT_PATH,
          path: ELEMENT_PATH,
          min: 1,
          max: '*',
          slicing: {
            discriminator: [{ type: 'value', path: 'resolve().code' }],
            rules: 'closed',
          },
        },
        {
          id: `${ELEMENT_PATH}:macroscopic-observations`,
          path: ELEMENT_PATH,
          sliceName: 'macroscopic-observations',
          min: 0,
          max: '1',
          type: [{ code: 'Reference', targetProfile: [MACRO] }],
        },
        {
          id: `${ELEMENT_PATH}:diagnostic-conclusion`,
          path: ELEMENT_PATH,
          sliceName: 'diagnostic-conclusion',
          min: 1,
          max: '1',
          type: [{ code: 'Reference', targetProfile: [GROUPER] }],
        },
      ],
    },
  } as unknown as StructureDefinition;
}

function targetDefinition(canonical: string): StructureDefinition | null {
  const source = canonical === GROUPER ? metadata.targets[4]
    : canonical === MACRO ? metadata.targets[1] : null;
  return source ? { ...structuredClone(source), url: canonical } as unknown as StructureDefinition : null;
}

function createValidator(): SlicingValidator {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => targetDefinition(canonical));
  return validator;
}

function resolverFor(profiles: Record<string, string>) {
  return (reference: string): unknown | null => {
    const profile = profiles[reference];
    return profile === undefined
      ? null
      : { resourceType: 'Observation', id: reference.split('/')[1],
          code: structuredClone(targetDefinition(profile)?.snapshot?.element[0].patternCodeableConcept),
          meta: { profile: [`${profile}|1.0.0`] } };
  };
}

describe('slicing whose discriminator traverses resolve()', () => {
  it('matches slices from the resolved targets code metadata', async () => {
    const issues = await createValidator().validateSlicing(
      [{ reference: 'Observation/macro' }, { reference: 'Observation/conclusion' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      resolverFor({ 'Observation/macro': MACRO, 'Observation/conclusion': GROUPER }),
    );

    expect(issues).toEqual([]);
  });

  it('reports the required slice when the resolved target has the other slice code', async () => {
    const issues = await createValidator().validateSlicing(
      [{ reference: 'Observation/macro' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      resolverFor({ 'Observation/macro': MACRO }),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        details: expect.objectContaining({ sliceName: 'diagnostic-conclusion' }),
      }),
    );
  });

  it('warns that the slicing is unverifiable rather than reporting when the target cannot be resolved', async () => {
    const issues = await createValidator().validateSlicing(
      [{ reference: 'Observation/macro' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      resolverFor({}),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-slice-validation-incomplete',
        severity: 'warning',
        details: expect.objectContaining({ reason: 'unresolved-reference-discriminator' }),
      }),
    );
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toEqual([]);
  });

  it('warns that the slicing is unverifiable when no resolver is supplied at all', async () => {
    const issues = await createValidator().validateSlicing(
      [{ reference: 'Observation/macro' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      null,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-slice-validation-incomplete',
        severity: 'warning',
        details: expect.objectContaining({ reason: 'unresolved-reference-discriminator' }),
      }),
    );
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toEqual([]);
  });

  it('warns instead of failing closed slicing for an element whose target cannot be resolved', async () => {
    const issues = await createValidator().validateSlicing(
      [{ reference: 'Observation/conclusion' }, { reference: 'Observation/unknown' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      resolverFor({ 'Observation/conclusion': GROUPER }),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-slice-validation-incomplete',
        severity: 'warning',
        details: expect.objectContaining({ reason: 'unresolved-reference-discriminator' }),
      }),
    );
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toEqual([]);
  });
});
