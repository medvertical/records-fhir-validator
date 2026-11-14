import { describe, expect, it } from 'vitest';
import type { Constraint, StructureDefinition } from '../../core/structure-definition-types.js';
import { parseFhirXml } from '../../input/fhir-xml-input.js';
import { parseFhirJson } from '../../input/fhir-json-input.js';
import { parseFhirNdjson } from '../../input/fhir-ndjson-input.js';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor.js';
import { ConstraintValidator } from '../constraint-validator.js';
import { SDFHIRPathConstraintEvaluator } from '../sd-fhirpath-constraint-evaluator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { validateSliceTypeProfileConstraints } from '../slicing-type-profile-constraints.js';
import { datatypeConformingSlices, prepareDatatypeProfileConformance } from '../slice-datatype-conformance.js';
import { withSliceInstanceEvidence } from '../slice-instance-evidence.js';

const constraint: Constraint = {
  key: 'decimal-two-places', severity: 'error', human: 'Exactly two decimal places',
  expression: "toString().matches('^-?\\\\d+\\\\.\\\\d{2}$')",
};

function profile(rule = constraint, path = 'Observation.valueQuantity.value'): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'https://example.org/decimal-source',
    name: 'DecimalSource', status: 'active', kind: 'resource', abstract: false, type: 'Observation',
    snapshot: { element: [
      { id: 'Observation', path: 'Observation' },
      { id: 'Observation.valueQuantity', path: 'Observation.valueQuantity', type: [{ code: 'Quantity' }] },
      { id: path, path,
        type: [{ code: 'decimal' }], constraint: [rule] },
    ] },
  };
}

const runners = {
  'SD constraints': async (resource: Record<string, unknown>, sd: StructureDefinition) =>
    new SDFHIRPathExecutor().execute({ resource, resourceType: 'Observation', structureDef: sd }),
  'slice constraints': async (resource: Record<string, unknown>, sd: StructureDefinition) =>
    new ConstraintValidator().validate(resource, sd.snapshot!.element, sd.url),
};

function xml(literal: string) {
  return `<Observation xmlns="http://hl7.org/fhir"><status value="final"/><code><text value="Decimal probe"/></code><valueQuantity><value value="${literal}"/></valueQuantity></Observation>`;
}

describe.each(Object.entries(runners))('%s preserves decimal source precision', (_name, run) => {
  it.each([
    ['19.00', true], ['19.0', false], ['19.01', true],
    ['-5.00', true], ['-5.0', false], ['0.00', true], ['1.900e1', false],
  ])('checks the original XML literal %s', async (literal, accepted) => {
    const resource = parseFhirXml(xml(literal)).resources[0];
    const before = JSON.stringify(resource);
    const issues = await run(resource, profile());
    expect(issues.filter(issue => issue.ruleId === constraint.key)).toHaveLength(accepted ? 0 : 1);
    if (!accepted) expect(issues[0].code).not.toBe('profile-constraint-evaluation-error');
    expect(JSON.stringify(resource)).toBe(before);
    expect(typeof (resource.valueQuantity as Record<string, unknown>).value).toBe('number');
  });

  it('keeps decimal arithmetic and FHIR typing', async () => {
    const resource = parseFhirXml(xml('19.00')).resources[0];
    const rule = { ...constraint, expression: '($this is decimal) and ($this + 0.01 = 19.01)' };
    expect(await run(resource, profile(rule))).toEqual([]);
  });

  it('still decides quantity comparisons when only a JSON numeric value is available', async () => {
    const resource = { resourceType: 'Observation', valueQuantity: {
      value: 19, system: 'http://unitsofmeasure.org', code: 'kg',
    } };
    const definition = profile();
    definition.snapshot!.element = [{ id: 'Observation', path: 'Observation', constraint: [{ ...constraint,
      expression: "value.toQuantity() < 20 'kg'" }] }];
    expect(await run(resource, definition)).toEqual([]);
    definition.snapshot!.element[0].constraint![0].expression = "value.toQuantity() < 18 'kg'";
    const issues = await run(resource, definition);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).not.toBe('profile-constraint-evaluation-error');
  });

  it('uses known scale for lowBoundary() and reports an unknown scale as incomplete', async () => {
    const resource = parseFhirXml(xml('19.00')).resources[0];
    const rule = { ...constraint, expression: 'lowBoundary() = 18.995' };
    expect(await run(resource, profile(rule))).toEqual([]);
    const unknown = JSON.parse(JSON.stringify(resource)) as Record<string, unknown>;
    const issues = await run(unknown, profile(rule));
    expect(issues[0]).toMatchObject({ code: 'profile-constraint-evaluation-error',
      details: { reason: 'decimal-source-unavailable' } });
  });

  it('reports unavailable source precision without rejecting a canonicalized JSON number', async () => {
    const resource = JSON.parse(JSON.stringify(parseFhirXml(xml('19.00')).resources[0])) as Record<string, unknown>;
    const issues = await run(resource, profile());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'profile-constraint-evaluation-error', ruleId: constraint.key });
    expect(issues[0].severity).not.toBe('error');
    expect(issues[0].details).toMatchObject({ reason: 'decimal-source-unavailable', validationComplete: false });
    const numericRule = { ...constraint, expression: '$this < 0' };
    const numericIssues = await run(resource, profile(numericRule));
    expect(numericIssues).toHaveLength(1);
    expect(numericIssues[0].code).not.toBe('profile-constraint-evaluation-error');
  });

  it.each([parseFhirJson, parseFhirNdjson])('preserves raw JSON/NDJSON tokens', async parse => {
    for (const literal of ['19.00', '19.0']) {
      const resource = parse(`{"resourceType":"Observation","valueQuantity":{"value":${literal}}}`).resources[0];
      const issues = await run(resource, profile());
      expect(issues).toHaveLength(literal === '19.00' ? 0 : 1);
      if (literal === '19.0') expect(issues[0].code).not.toBe('profile-constraint-evaluation-error');
    }
  });

  it('distinguishes equal numbers in separate array positions', async () => {
    const resource = parseFhirXml('<Observation xmlns="http://hl7.org/fhir"><component><valueQuantity><value value="5.00"/></valueQuantity></component><component><valueQuantity><value value="5.0"/></valueQuantity></component></Observation>').resources[0];
    const issues = await run(resource, profile(constraint, 'Observation.component.valueQuantity.value'));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('Observation.component[1].valueQuantity.value');
    expect(issues[0].code).not.toBe('profile-constraint-evaluation-error');
  });

  it('retains exact values beyond Number precision during constraint evaluation', async () => {
    const resource = parseFhirXml(xml('12345678901234567890.00')).resources[0];
    const rule = { ...constraint, expression: '$this = 12345678901234567890.00 and $this + 0.01 = 12345678901234567890.01' };
    expect(await run(resource, profile(rule))).toEqual([]);
  });

  it('uses original precision from %resource as well as the local primitive', async () => {
    const resource = parseFhirXml(xml('19.00')).resources[0];
    const rule = { ...constraint, expression: "toString() = '19.00' and %resource.valueQuantity.value.toString() = '19.00'" };
    expect(await run(resource, profile(rule))).toEqual([]);
  });

  it('does not reuse a previous validation projection after the input changes', async () => {
    const resource = parseFhirXml(xml('19.00')).resources[0];
    expect(await run(resource, profile())).toEqual([]);
    (resource.valueQuantity as Record<string, unknown>).value = 20;
    const issues = await run(resource, profile());
    expect(issues[0]).toMatchObject({ code: 'profile-constraint-evaluation-error' });
  });
});

it('keeps source precision in collected SD constraints and embedded resources', async () => {
  const resource = parseFhirXml('<Bundle xmlns="http://hl7.org/fhir"><entry><resource><Observation><valueQuantity><value value="5.00"/></valueQuantity></Observation></resource></entry></Bundle>').resources[0];
  const issues = await new SDFHIRPathConstraintEvaluator(new ValueSetCache()).evaluateCollectedConstraint({
    constraint: { ...constraint, expression: "toString() = '5.00' and %resource.valueQuantity.value.toString() = '5.00' and %rootResource.resourceType = 'Bundle'" },
    elementPath: 'Bundle.entry.resource.valueQuantity.value', elementTypes: ['decimal'], isRootConstraint: false, minCardinality: 0,
  }, { resource, rootResource: resource, resourceType: 'Bundle', fhirVersion: 'R4', userInvocationTable: {} });
  expect(issues).toEqual([]);
});

it.each(['5.00', '5.0'])('preserves %s when a Money slice becomes a datatype pseudo-resource', async literal => {
  const resource = parseFhirXml(`<Invoice xmlns="http://hl7.org/fhir"><totalNet><value value="${literal}"/></totalNet></Invoice>`).resources[0];
  const definition = { ...profile(), type: 'Money', snapshot: { element: [
    { id: 'Money', path: 'Money' }, { id: 'Money.value', path: 'Money.value', type: [{ code: 'decimal' }], constraint: [constraint] },
  ] } };
  const issues = await validateSliceTypeProfileConstraints(resource.totalNet,
    { sliceName: 'amount', min: 0, max: '1', type: [{ code: 'Money', profile: [definition.url] }] },
    'Invoice.totalNet', 'R4', async () => definition, new ConstraintValidator(), resource);
  expect(issues).toHaveLength(literal === '5.00' ? 0 : 1);
  if (issues.length) expect(issues[0]).toMatchObject({ ruleId: constraint.key, path: 'Invoice.totalNet.value' });
});

it.each(['5.00', '5.0'])('keeps the decimal %s in profile-discriminator evidence', async literal => {
  await withSliceInstanceEvidence(async () => {
    const resource = parseFhirXml(`<Invoice xmlns="http://hl7.org/fhir"><totalNet><value value="${literal}"/></totalNet></Invoice>`).resources[0];
    const definition = { ...profile(), type: 'Money', snapshot: { element: [
      { id: 'Money', path: 'Money' }, { id: 'Money.value', path: 'Money.value', type: [{ code: 'decimal' }], constraint: [constraint] },
    ] } };
    await prepareDatatypeProfileConformance([resource.totalNet], [
      { sliceName: 'amount', min: 0, max: '1', type: [{ code: 'Money', profile: [definition.url] }] },
    ], { discriminator: [{ type: 'profile', path: '$this' }] }, async () => definition);
    expect(datatypeConformingSlices(resource.totalNet)?.has('amount')).toBe(literal === '5.00');
  });
});
