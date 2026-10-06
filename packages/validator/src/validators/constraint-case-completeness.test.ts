import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../core/structure-definition-types';
import { ConstraintValidator } from './constraint-validator';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor';
import { ValueSetCache } from './valueset-cache';

const known = 'https://example.test/ValueSet/known';
const unavailable = 'https://example.test/ValueSet/unavailable';
function profile(valueSet: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `https://example.test/Profile/${valueSet === known ? 'known' : 'unknown'}`,
    name: 'MembershipPatient', status: 'active', kind: 'resource', abstract: false, type: 'Patient',
    snapshot: { element: [{ id: 'Patient', path: 'Patient' }, { id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
      type: [{ code: 'CodeableConcept' }], constraint: [{ key: 'membership-1', severity: 'error', human: 'Membership is required',
        expression: `where(coding.memberOf('${valueSet}')).exists()` }] }] } };
}

function cache() {
  const values = new ValueSetCache();
  values.setValueSetFile(`${known}|R4`, { resourceType: 'ValueSet', url: known, status: 'active',
    compose: { include: [{ system: 'https://example.test/CodeSystem/marital', concept: [{ code: 'M' }] }] } });
  values.setValueSetFile(`${unavailable}|R4`, null);
  return values;
}
const resource = (code: string) => ({ resourceType: 'Patient', maritalStatus: {
  coding: [{ system: 'https://example.test/CodeSystem/marital', code }],
} });

describe('constraint completeness is bound to each validation', () => {
  it.each(['general', 'StructureDefinition'] as const)('separates concurrent valid, invalid and unknown %s results', async implementation => {
    const values = cache();
    const general = new ConstraintValidator(undefined, undefined, values);
    const sd = new SDFHIRPathExecutor(values);
    const run = (code: string, definition: StructureDefinition) => implementation === 'general'
      ? general.validate(resource(code), definition.snapshot!.element, definition.url!)
      : sd.execute({ resource: resource(code), resourceType: 'Patient', structureDef: definition });
    const [valid, invalid, unknown] = await Promise.all([run('M', profile(known)), run('X', profile(known)), run('X', profile(unavailable))]);
    expect(valid).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ severity: 'error', ruleId: 'membership-1' });
    expect(invalid[0].details?.validationComplete).not.toBe(false);
    expect(unknown).toEqual([expect.objectContaining({ severity: 'information', code: 'profile-constraint-evaluation-error',
      ruleId: 'membership-1', path: 'Patient.maritalStatus', details: expect.objectContaining({ validationComplete: false }) })]);
  });
});
