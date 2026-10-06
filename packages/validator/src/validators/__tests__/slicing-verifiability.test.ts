import { describe, expect, it } from 'vitest';
import type {
  SlicingDefinition,
  SlicingDiscriminator,
} from '../../core/structure-definition-types';
import type { SliceDefinition } from '../slice-types';
import { assessSlicingVerifiability } from '../slicing-verifiability';

const elementPath = 'Observation.component';
const discriminator: SlicingDiscriminator = { type: 'value', path: 'code' };
const slicing: SlicingDefinition = {
  discriminator: [discriminator],
  rules: 'open',
};

function slice(sliceName: string, code?: string): SliceDefinition {
  return {
    sliceName,
    path: elementPath,
    min: 0,
    max: '*',
    childFixed: code === undefined ? undefined : new Map([['code', code]]),
  };
}

describe('assessSlicingVerifiability', () => {
  it('blocks matching when no slice resolves a discriminator', () => {
    const assessment = assessSlicingVerifiability({
      slices: [slice('systolic'), slice('diastolic')],
      slicing,
      elementPath,
    });

    expect(assessment.blockingIssues).toHaveLength(1);
    expect(assessment.blockingIssues[0]).toMatchObject({
      code: 'profile-slice-validation-incomplete',
      severity: 'information',
      path: elementPath,
      details: {
        reason: 'unresolved-discriminator-metadata',
        unresolvedDiscriminators: ['value:code'],
      },
    });
    expect(assessment.advisoryIssues).toEqual([]);
    expect(assessment.unresolvedSliceNames.size).toBe(0);
  });

  it('keeps matching possible while identifying unresolved slice identities', () => {
    const assessment = assessSlicingVerifiability({
      slices: [slice('systolic'), slice('diastolic', '8462-4')],
      slicing,
      elementPath,
    });

    expect(assessment.blockingIssues).toEqual([]);
    expect(Array.from(assessment.unresolvedSliceNames)).toEqual(['systolic']);
    expect(assessment.advisoryIssues).toHaveLength(1);
    expect(assessment.advisoryIssues[0]).toMatchObject({
      severity: 'information',
      details: {
        reason: 'unresolved-slice-discriminator-metadata',
        unresolvedSliceNames: ['systolic'],
      },
    });
  });

  it('reports a fully verifiable slicing definition without issues', () => {
    const assessment = assessSlicingVerifiability({
      slices: [slice('systolic', '8480-6'), slice('diastolic', '8462-4')],
      slicing,
      elementPath,
    });

    expect(assessment).toEqual({
      blockingIssues: [],
      advisoryIssues: [],
      unresolvedSliceNames: new Set(),
    });
  });
});
