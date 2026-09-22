import { describe, expect, it, vi } from 'vitest';
import { ComplexTypeValidator } from '../complex-type-validator';
import { DatatypeInvariantEvaluator } from '../datatype-invariant-evaluator';
import type { StructureDefinition } from '../../core/structure-definition-types';

function datatypeSd(
  type: string,
  elements: Array<Record<string, unknown>>,
): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    name: type,
    status: 'active',
    kind: 'complex-type',
    abstract: false,
    type,
    snapshot: { element: [{ path: type }, ...elements] as never },
  } as StructureDefinition;
}

const rangeSd = datatypeSd('Range', [
  {
    path: 'Range',
    constraint: [{
      key: 'rng-2',
      severity: 'error',
      human: 'If present, low SHALL have a lower value than high',
      expression: 'low.empty() or high.empty() or (low <= high)',
    }],
  },
  { path: 'Range.low', min: 0, max: '1', type: [{ code: 'Quantity' }] },
  { path: 'Range.high', min: 0, max: '1', type: [{ code: 'Quantity' }] },
]);

const quantitySd = datatypeSd('Quantity', [
  {
    path: 'Quantity',
    constraint: [{
      key: 'qty-3',
      severity: 'error',
      human: 'If a code for the unit is present, the system SHALL also be present',
      expression: 'code.empty() or system.exists()',
    }],
  },
  { path: 'Quantity.value', min: 0, max: '1', type: [{ code: 'decimal' }] },
  { path: 'Quantity.system', min: 0, max: '1', type: [{ code: 'uri' }] },
  { path: 'Quantity.code', min: 0, max: '1', type: [{ code: 'code' }] },
]);

const ratioSd = datatypeSd('Ratio', [
  {
    path: 'Ratio',
    constraint: [{
      key: 'rat-1',
      severity: 'error',
      human: 'Numerator and denominator SHALL both be present, or both are absent. If both are absent, there SHALL be some extension present',
      expression: '(numerator.empty() xor denominator.exists()) and (numerator.exists() or extension.exists())',
    }],
  },
  { path: 'Ratio.numerator', min: 0, max: '1', type: [{ code: 'Quantity' }] },
  { path: 'Ratio.denominator', min: 0, max: '1', type: [{ code: 'Quantity' }] },
]);

const timingSd = datatypeSd('Timing', [
  { path: 'Timing.event', min: 0, max: '*', type: [{ code: 'dateTime' }] },
  {
    path: 'Timing.repeat',
    min: 0,
    max: '1',
    type: [{ code: 'Element' }],
    constraint: [{
      key: 'tim-1',
      severity: 'error',
      human: 'if there\'s a duration, there needs to be duration units',
      expression: 'duration.empty() or durationUnit.exists()',
    }],
  },
]);

function loaderFor(definitions: StructureDefinition[]) {
  return {
    loadProfile: vi.fn().mockImplementation(async (url: string) => (
      definitions.find(sd => sd.url === url) ?? null
    )),
  };
}

function invariantIssues(issues: Array<{ code: string; details?: unknown }>, key: string) {
  return issues.filter(issue =>
    issue.code === 'profile-constraint-violation' &&
    (issue.details as { constraintKey?: string } | undefined)?.constraintKey === key,
  );
}

describe('DatatypeInvariantEvaluator through ComplexTypeValidator', () => {
  it('reports rng-2 when Range.low exceeds Range.high', async () => {
    const validator = new ComplexTypeValidator(loaderFor([rangeSd, quantitySd]) as never);
    const issues = await validator.validateComplexTypeSubElements(
      {
        low: { value: 10, system: 'http://unitsofmeasure.org', code: 'mg' },
        high: { value: 2, system: 'http://unitsofmeasure.org', code: 'mg' },
      },
      { path: 'Observation.valueRange', type: [{ code: 'Range' }] },
      'Observation.valueRange',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    );

    const violations = invariantIssues(issues, 'rng-2');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      severity: 'error',
      path: 'Observation.valueRange',
      // rng-2 is answered by the dedicated bounds check rather than the
      // generic FHIRPath path, so the message names the two values.
      message: expect.stringContaining('is greater than Range.high'),
    });
  });

  it('passes rng-2 for an ordered Range', async () => {
    const validator = new ComplexTypeValidator(loaderFor([rangeSd, quantitySd]) as never);
    const issues = await validator.validateComplexTypeSubElements(
      {
        low: { value: 1, system: 'http://unitsofmeasure.org', code: 'mg' },
        high: { value: 2, system: 'http://unitsofmeasure.org', code: 'mg' },
      },
      { path: 'Observation.valueRange', type: [{ code: 'Range' }] },
      'Observation.valueRange',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    );

    expect(invariantIssues(issues, 'rng-2')).toHaveLength(0);
  });

  it('reports qty-3 when a Quantity has a code but no system', async () => {
    const validator = new ComplexTypeValidator(loaderFor([quantitySd]) as never);
    const issues = await validator.validateComplexTypeSubElements(
      { value: 5, code: 'mg' },
      { path: 'Observation.valueQuantity', type: [{ code: 'Quantity' }] },
      'Observation.valueQuantity',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    );

    expect(invariantIssues(issues, 'qty-3')).toHaveLength(1);
  });

  it('reports qty-3 on a nested Quantity inside a Range', async () => {
    const validator = new ComplexTypeValidator(loaderFor([rangeSd, quantitySd]) as never);
    const issues = await validator.validateComplexTypeSubElements(
      { low: { value: 1, code: 'mg' } },
      { path: 'Observation.valueRange', type: [{ code: 'Range' }] },
      'Observation.valueRange',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    );

    const violations = invariantIssues(issues, 'qty-3');
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('Observation.valueRange.low');
  });

  it('reports rat-1 when only a numerator is present', async () => {
    const validator = new ComplexTypeValidator(loaderFor([ratioSd, quantitySd]) as never);
    const issues = await validator.validateComplexTypeSubElements(
      { numerator: { value: 1 } },
      { path: 'Observation.valueRatio', type: [{ code: 'Ratio' }] },
      'Observation.valueRatio',
      'http://hl7.org/fhir/StructureDefinition/Observation',
    );

    expect(invariantIssues(issues, 'rat-1')).toHaveLength(1);
  });

  it('evaluates nested-element constraints such as tim-1 on Timing.repeat', async () => {
    const elementSd = datatypeSd('Element', []);
    const validator = new ComplexTypeValidator(loaderFor([timingSd, elementSd]) as never);
    const issues = await validator.validateComplexTypeSubElements(
      { repeat: { duration: 2 } },
      { path: 'MedicationRequest.dosageInstruction.timing', type: [{ code: 'Timing' }] },
      'MedicationRequest.dosageInstruction[0].timing',
      'http://hl7.org/fhir/StructureDefinition/MedicationRequest',
    );

    const violations = invariantIssues(issues, 'tim-1');
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('MedicationRequest.dosageInstruction[0].timing.repeat');
  });
});

describe('DatatypeInvariantEvaluator ownership and exclusions', () => {
  const evaluate = (structureDef: StructureDefinition, value: Record<string, unknown>) =>
    new DatatypeInvariantEvaluator().evaluate({
      value,
      structureDef,
      basePath: 'Observation.component[0].valueX',
      profileUrl: '',
      fhirVersion: 'R4',
    });

  it('leaves per-1 to the dedicated Period reporter', () => {
    const periodSd = datatypeSd('Period', [{
      path: 'Period',
      constraint: [{
        key: 'per-1',
        severity: 'error',
        human: 'If present, start SHALL have a lower value than end',
        expression: 'start.hasValue().not() or end.hasValue().not() or (start <= end)',
      }],
    }]);

    expect(evaluate(periodSd, { start: '2024-02-01', end: '2024-01-01' })).toHaveLength(0);
  });

  it('leaves att-1 to the attachment validator', () => {
    const attachmentSd = datatypeSd('Attachment', [{
      path: 'Attachment',
      constraint: [{
        key: 'att-1',
        severity: 'error',
        human: 'If the Attachment has data, it SHALL have a contentType',
        expression: 'data.empty() or contentType.exists()',
      }],
    }]);

    expect(evaluate(attachmentSd, { data: 'AAAA' })).toHaveLength(0);
  });

  it('skips expressions using unsupported FHIRPath features', () => {
    const narrativeSd = datatypeSd('Narrative', [{
      path: 'Narrative',
      constraint: [{
        key: 'txt-1',
        severity: 'error',
        human: 'The narrative SHALL contain only basic html',
        expression: 'htmlChecks()',
      }],
    }]);

    expect(evaluate(narrativeSd, { status: 'generated', div: '<div/>' })).toHaveLength(0);
  });

  it('skips warning-severity rows', () => {
    const warnSd = datatypeSd('Range', [{
      path: 'Range',
      constraint: [{
        key: 'rng-x',
        severity: 'warning',
        human: 'advisory only',
        expression: 'false',
      }],
    }]);

    expect(evaluate(warnSd, { low: { value: 1 } })).toHaveLength(0);
  });

  it('treats evaluation errors as unevaluated instead of failing', () => {
    const brokenSd = datatypeSd('Range', [{
      path: 'Range',
      constraint: [{
        key: 'rng-broken',
        severity: 'error',
        human: 'broken expression',
        expression: 'this is not fhirpath((',
      }],
    }]);

    expect(evaluate(brokenSd, { low: { value: 1 } })).toHaveLength(0);
  });

  it('evaluates R5 sdd-1 with the R5 model', () => {
    const sampledDataSd = datatypeSd('SampledData', [{
      path: 'SampledData',
      constraint: [{
        key: 'sdd-1',
        severity: 'error',
        human: 'A SampledData SHALL have either an interval or offsets but not both',
        expression: 'interval.exists().not() xor offsets.exists().not()',
      }],
    }]);
    const issues = new DatatypeInvariantEvaluator().evaluate({
      value: { interval: 1, offsets: '1 2 3' },
      structureDef: sampledDataSd,
      basePath: 'Observation.valueSampledData',
      profileUrl: '',
      fhirVersion: 'R5',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].details).toMatchObject({ constraintKey: 'sdd-1' });
  });
});
