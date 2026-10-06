import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { ConstraintValidator } from '../constraint-validator.js';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor.js';

const dar = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason';
const sidecar = { extension: [{ url: dar, valueCode: 'masked' }] };
const matches = "matches('^[A-Z][0-9]{9}$')";

async function run(implementation: 'general' | 'SD', identifiers: Record<string, unknown>[], expression = matches) {
  const profile: StructureDefinition = { resourceType: 'StructureDefinition',
    url: 'https://records.test/Profile/primitive-context', name: 'PrimitiveContext',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient',
    snapshot: { element: [{ id: 'Patient', path: 'Patient' },
      { id: 'Patient.identifier', path: 'Patient.identifier', type: [{ code: 'Identifier' }] },
      { id: 'Patient.identifier.value', path: 'Patient.identifier.value', type: [{ code: 'string' }],
        constraint: [{ key: 'primitive-rule', severity: 'warning', human: 'KVID format', expression }] } ] } };
  const resource = { resourceType: 'Patient', identifier: identifiers };
  return implementation === 'general'
    ? new ConstraintValidator().validate(resource, profile.snapshot!.element, profile.url!)
    : new SDFHIRPathExecutor().execute({ resource, resourceType: 'Patient', structureDef: profile });
}

const failedAt = (index: number) => [expect.objectContaining({ severity: 'warning',
  ruleId: 'primitive-rule', path: `Patient.identifier[${index}].value` })];

describe.each(['general', 'SD'] as const)('%s primitive sidecar context', implementation => {
  it('preserves positive and negative string verdicts', async () => {
    await expect(run(implementation, [{ value: 'A123456789' }])).resolves.toEqual([]);
    expect(await run(implementation, [{ value: 'incorrect' }])).toEqual(failedAt(0));
  });

  it('publishes a definite constraint warning for a DAR-only string', async () => {
    const issues = await run(implementation, [{ _value: sidecar }]);
    expect(issues).toEqual(failedAt(0));
    expect(issues[0].details?.validationComplete).not.toBe(false);
    expect(issues[0].code).not.toBe('profile-constraint-evaluation-error');
  });

  it('retains hasValue, extension access and context/resource variables', async () => {
    const expression = `hasValue().not() and extension('${dar}').valueCode = 'masked'`
      + ` and %context.extension[0].url = '${dar}'`
      + " and %resource.resourceType = 'Patient' and %rootResource.resourceType = 'Patient'";
    await expect(run(implementation, [{ _value: sidecar }], expression)).resolves.toEqual([]);
  });

  it('actually evaluates a false DAR extension condition', async () => {
    expect(await run(implementation, [{ _value: sidecar }], `extension('${dar}').valueCode = 'unknown'`))
      .toEqual(failedAt(0));
  });

  it('keeps a DAR extension accessible in an OR with missing-value matches', async () => {
    await expect(run(implementation, [{ _value: sidecar }], `${matches} or extension('${dar}').valueCode = 'masked'`))
      .resolves.toEqual([]);
  });

  it('keeps each repeating identifier at its concrete path', async () => {
    const issues = await run(implementation, [{ value: 'A123456789' }, { _value: sidecar }]);
    expect(issues).toEqual(failedAt(1));
    expect(issues[0].details?.validationComplete).not.toBe(false);
  });

  it('evaluates an explicitly null primitive through its sidecar', async () => {
    expect(await run(implementation, [{ value: null, _value: sidecar }])).toEqual(failedAt(0));
  });

  it('keeps an unmarked malformed primitive object as an evaluation failure', async () => {
    const issues = await run(implementation, [{ value: sidecar }]);
    expect(issues).toEqual([expect.objectContaining({ severity: 'information',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });
});
