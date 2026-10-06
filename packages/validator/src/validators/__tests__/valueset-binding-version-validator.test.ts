import { describe, expect, it } from 'vitest';
import { validateCodeSystemVersions } from '../valueset-binding-version-validator';
import type { ValueSetPackageLoader } from '../valueset-package-loader';

const STUDY_DESIGN = 'http://hl7.org/fhir/study-design';

function loader(valueSet: Record<string, unknown>) {
  return { loadValueSetResource: async () => valueSet } as unknown as ValueSetPackageLoader;
}

const coreValueSet = {
  resourceType: 'ValueSet',
  url: 'http://hl7.org/fhir/ValueSet/study-design',
  version: '5.0.0',
  status: 'active',
  compose: { include: [{ system: STUDY_DESIGN }] },
};

async function check(valueSet: Record<string, unknown>, version: string) {
  return validateCodeSystemVersions(
    loader(valueSet),
    { coding: [{ system: STUDY_DESIGN, version, code: 'SEVCO:01002' }] },
    [{ system: STUDY_DESIGN, version, code: 'SEVCO:01002', codingIndex: 0 }] as never,
    'extensible',
    'http://hl7.org/fhir/ValueSet/study-design',
    'Evidence.studyDesign[0]',
    { fhirVersion: 'R5' },
  );
}

describe('validateCodeSystemVersions', () => {
  it('holds a versionless include of a specification code system to the release of its value set', async () => {
    expect(await check(coreValueSet, '5.0.0-cibuild')).toEqual([expect.objectContaining({
      code: 'terminology-code-system-version-mismatch',
      severity: 'warning',
      path: 'Evidence.studyDesign[0].coding[0].version',
    })]);
    expect(await check(coreValueSet, '5.0.0')).toEqual([]);
  });

  it('leaves a versionless include of an IG or external code system unconstrained', async () => {
    const igValueSet = { ...coreValueSet, url: 'http://hl7.org/fhir/uv/ebm/ValueSet/study-design' };
    expect(await check(igValueSet, '5.0.0-cibuild')).toEqual([]);
  });
});
