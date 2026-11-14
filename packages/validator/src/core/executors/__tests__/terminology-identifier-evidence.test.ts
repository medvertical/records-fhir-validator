import { describe, expect, it } from 'vitest';
import { TerminologyExecutor } from '../terminology-executor';
import { createTerminologyValidationPortMock } from './terminology-validation-port.test-support';

describe('Identifier syntax and terminology authority stay separate', () => {
  it.each([
    ['http://snomed.info/sct', '100014', 'snomed-component-kind'],
    ['http://snomed.info/sct', '100545', 'snomed-partition'],
    ['http://fhir.de/CodeSystem/ifa/pzn', '27580898', 'pzn-check-digit'],
  ])('reports a local defect in %s#%s when the exact edition is unavailable', async (system, code, reason) => {
    const port = createTerminologyValidationPortMock();
    port.validateCodeInCodeSystem.mockResolvedValue({ valid: false, reason: 'system-unresolvable' });
    const resource = { resourceType: 'Observation', code: { coding: [{ system, code, version: 'unavailable-edition' }] } };
    const issues = await new TerminologyExecutor(port).validate({
      resource, getValueAtPath: () => resource.code,
      structureDef: { type: 'Observation', snapshot: { element: [
        { path: 'Observation.code', type: [{ code: 'CodeableConcept' }] },
      ] } },
    });
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'terminology-code-invalid', severity: 'error',
      path: 'Observation.code.coding[0].code', details: expect.objectContaining({ reason }),
    }));
    expect(port.validateCodeInCodeSystem).toHaveBeenCalledWith(code, system, undefined, 'R4', 'unavailable-edition');
  });

  it.each([
    ['http://snomed.info/sct', '100005'],
    ['http://snomed.info/sct', '11000001160'],
    ['http://fhir.de/CodeSystem/ifa/pzn', '27580899'],
    ['http://fhir.de/CodeSystem/ifa/pzn', '03752864'],
  ])('retains missing-membership evidence for checksum-valid %s#%s', async (system, code) => {
    const port = createTerminologyValidationPortMock();
    port.validateCodeInCodeSystem.mockResolvedValue({ valid: false, reason: 'system-unresolvable' });
    const resource = { resourceType: 'Observation', code: { coding: [{ system, code, version: 'unavailable-edition' }] } };
    const issues = await new TerminologyExecutor(port).validate({
      resource, getValueAtPath: () => resource.code,
      structureDef: { type: 'Observation', snapshot: { element: [
        { path: 'Observation.code', type: [{ code: 'CodeableConcept' }] },
      ] } },
    });
    expect(issues.some(issue => issue.code === 'terminology-code-invalid')).toBe(false);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'terminology-codesystem-unresolvable',
      details: expect.objectContaining({ codeSystemVersion: 'unavailable-edition' }),
    }));
  });
});
