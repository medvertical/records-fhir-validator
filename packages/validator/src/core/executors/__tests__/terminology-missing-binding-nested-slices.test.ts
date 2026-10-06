import { describe, expect, it, vi } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types';
import { TerminologyExecutor } from '../terminology-executor';
import { createTerminologyValidationPortMock } from './terminology-validation-port.test-support';
import { getValueAtPath } from '../../validation-utils';

vi.mock('../../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// CCRR slices PlanDefinition.action and the actions nested in it; a nested
// slice's condition requires a bound `kind`, but only where a condition exists.
const KIND_VALUE_SET = 'http://hl7.org/fhir/ValueSet/action-condition-kind';
const byCode = { discriminator: [{ type: 'value', path: 'id' }], rules: 'open' };
const planDefinition = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/us/central-cancer-registry-reporting/StructureDefinition/ccrr-plandefinition',
  type: 'PlanDefinition',
  snapshot: {
    element: [
      { id: 'PlanDefinition', path: 'PlanDefinition' },
      { id: 'PlanDefinition.action', path: 'PlanDefinition.action', slicing: byCode },
      { id: 'PlanDefinition.action:checkReportable', path: 'PlanDefinition.action', sliceName: 'checkReportable' },
      { id: 'PlanDefinition.action:checkReportable.id', path: 'PlanDefinition.action.id', fixedString: 'check-reportable' },
      { id: 'PlanDefinition.action:checkReportable.action', path: 'PlanDefinition.action.action', slicing: byCode },
      { id: 'PlanDefinition.action:checkReportable.action:isReportable', path: 'PlanDefinition.action.action', sliceName: 'isReportable' },
      { id: 'PlanDefinition.action:checkReportable.action:isReportable.id', path: 'PlanDefinition.action.action.id', fixedString: 'is-reportable' },
      {
        id: 'PlanDefinition.action:checkReportable.action:isReportable.condition.kind',
        path: 'PlanDefinition.action.action.condition.kind',
        min: 1,
        max: '1',
        type: [{ code: 'code' }],
        binding: { strength: 'required', valueSet: KIND_VALUE_SET },
      },
    ] as ElementDefinition[],
  },
} as unknown as StructureDefinition;

describe('required bindings inside nested slices', () => {
  it('reports no missing binding where the slice instances carry no parent element', async () => {
    const executor = new TerminologyExecutor(createTerminologyValidationPortMock());
    const resource = {
      resourceType: 'PlanDefinition',
      action: [
        { id: 'check-reportable', action: [{ id: 'is-reportable', title: 'no condition here' }] },
        { id: 'other', action: [{ id: 'nested', condition: [{ kind: 'applicability' }] }] },
      ],
    };

    const issues = await executor.validate({ resource, structureDef: planDefinition, getValueAtPath });

    expect(issues.filter(issue => issue.code === 'binding-required-missing')).toEqual([]);
  });
});
