import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

const GROUPER = 'http://example.org/StructureDefinition/diagnostic-conclusion-grouper';
const MACRO = 'http://example.org/StructureDefinition/macroscopic-grouper';
const ELEMENT_PATH = 'DiagnosticReport.result';

/**
 * Mirrors MII `mii-pr-patho-report`: `resolve()`-traversing discriminator,
 * closed slicing, and slices that carry nothing but `targetProfile`.
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

function resolverFor(profiles: Record<string, string>) {
  return (reference: string): unknown | null => {
    const profile = profiles[reference];
    return profile === undefined
      ? null
      : { resourceType: 'Observation', id: reference.split('/')[1], meta: { profile: [`${profile}|1.0.0`] } };
  };
}

describe('slicing whose discriminator traverses resolve()', () => {
  it('matches a targetProfile-only slice against the resolved target profile', async () => {
    const issues = await new SlicingValidator().validateSlicing(
      [{ reference: 'Observation/macro' }, { reference: 'Observation/conclusion' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      resolverFor({ 'Observation/macro': MACRO, 'Observation/conclusion': GROUPER }),
    );

    expect(issues).toEqual([]);
  });

  it('reports the required slice when the resolved target conforms to another profile', async () => {
    const issues = await new SlicingValidator().validateSlicing(
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

  it('leaves the slicing unverifiable rather than reporting when the target cannot be resolved', async () => {
    const issues = await new SlicingValidator().validateSlicing(
      [{ reference: 'Observation/macro' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      resolverFor({}),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-slice-validation-error',
        severity: 'information',
        details: expect.objectContaining({ reason: 'unresolved-reference-discriminator' }),
      }),
    );
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toEqual([]);
  });

  it('leaves the slicing unverifiable when no resolver is supplied at all', async () => {
    const issues = await new SlicingValidator().validateSlicing(
      [{ reference: 'Observation/macro' }],
      ELEMENT_PATH,
      targetProfileOnlyProfile(),
      null,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-slice-validation-error',
        severity: 'information',
        details: expect.objectContaining({ reason: 'unresolved-reference-discriminator' }),
      }),
    );
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toEqual([]);
  });
});
