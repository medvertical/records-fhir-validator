import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';
import type { StructureDefinition } from '../structure-definition-types';
import type { MultiAspectValidateResult } from '../multi-aspect-types';

const known = 'https://example.test/StructureDefinition/known-patient';
const unknown = 'https://example.test/StructureDefinition/unknown-patient';

function definition(url: string, expression?: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url, name: 'CompletenessPatient', status: 'active',
    kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1',
    snapshot: { element: [
      { id: 'Patient', path: 'Patient', min: 0, max: '*', constraint: expression
        ? [{ key: 'parity-membership-1', severity: 'error', human: 'Known membership', expression }] : [] },
      { id: 'Patient.meta', path: 'Patient.meta', min: 0, max: '1', type: [{ code: 'Meta' }] },
      { id: 'Patient.gender', path: 'Patient.gender', min: 0, max: '1', type: [{ code: 'code' }] },
    ] },
  };
}

describe('public validator constraint completeness', () => {
  it.each([false, true])('preserves single and batch unknown checks with advisor suppression=%s', async suppressed => {
    const cache = await mkdtemp(join(tmpdir(), 'records-constraint-completeness-'));
    const validator = new RecordsValidator({ packageCachePath: cache, bundledProfilesPath: null, autoDownload: false });
    try {
      await validator.waitForInitialization();
      const loader = validator.getSdLoader();
      loader.registerExternalProfile(definition('http://hl7.org/fhir/StructureDefinition/Patient'), 'R4');
      loader.registerExternalProfile(definition(known, "gender = 'female'"), 'R4');
      loader.registerExternalProfile(definition(unknown, "where(gender.memberOf('https://example.test/ValueSet/unavailable')).exists()"), 'R4');
      const settings = { validationStrictness: 'standard', aspects: {},
        advisorRules: suppressed ? [{ id: 'hide-unchecked', enabled: true, action: 'suppress',
          match: { code: 'profile-constraint-evaluation-error' } }] : [],
      } as unknown as ValidationSettings;
      const resource = (gender: string, profile: string) => ({ resourceType: 'Patient', gender, meta: { profile: [profile] } });
      const valid = resource('female', known);
      const invalid = resource('male', known);
      const incomplete = resource('female', unknown);
      const single = await validator.validate(incomplete, unknown, 'R4');
      expect(single).toContainEqual(expect.objectContaining({ code: 'profile-constraint-evaluation-error',
        ruleId: 'parity-membership-1', details: expect.objectContaining({ validationComplete: false }) }));
      const options = { aspects: ['profile', 'invariant'] as const, settings, maxConcurrency: 3 };
      const batch = await validator.validateBatch([valid, invalid, incomplete], { ...options, aspects: [...options.aspects] });
      const result = batch.get(incomplete) as MultiAspectValidateResult;
      expect((batch.get(valid) as MultiAspectValidateResult).isValid).toBe(true);
      expect((batch.get(invalid) as MultiAspectValidateResult).isValid).toBe(false);
      expect(result.isValid).toBe(false);
      expect(result.aspects.flatMap(aspect => aspect.evidenceIssues ?? [])).toContainEqual(expect.objectContaining({
        code: 'profile-constraint-evaluation-error', ruleId: 'parity-membership-1',
        disposition: suppressed ? 'suppressed' : 'active', details: expect.objectContaining({ validationComplete: false }),
      }));
      if (suppressed) expect(result.aspects.flatMap(aspect => aspect.issues)).not.toContainEqual(
        expect.objectContaining({ code: 'profile-constraint-evaluation-error' }));
      const direct = await validator.validateAspects(incomplete, { ...options, aspects: [...options.aspects] });
      expect(direct.isValid).toBe(false);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });
});
