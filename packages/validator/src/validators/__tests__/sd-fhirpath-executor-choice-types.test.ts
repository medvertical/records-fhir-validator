import { describe, expect, it } from 'vitest';
import { sdFHIRPathExecutor } from '../sd-fhirpath-executor';
import { MustSupportValidator } from '../must-support-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

const bloodPressureObservation = {
  resourceType: 'Observation',
  id: 'bp-panel',
  component: [
    {
      code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
      valueQuantity: { value: 79, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
    },
    {
      code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
      valueQuantity: { value: 93, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
    },
  ],
};

const vitalsProfile = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/vitalsigns',
  name: 'Vitalsigns',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Observation',
  snapshot: {
    element: [
      { id: 'Observation', path: 'Observation' },
      {
        id: 'Observation.component',
        path: 'Observation.component',
        type: [{ code: 'BackboneElement' }],
        constraint: [
          {
            key: 'vs-3',
            severity: 'error',
            human: 'If there is no a value a data absent reason must be present',
            expression: 'value.exists() or dataAbsentReason.exists()',
          },
        ],
      },
      { id: 'Observation.value[x]', path: 'Observation.value[x]', mustSupport: true },
      { id: 'Observation.component.dataAbsentReason', path: 'Observation.component.dataAbsentReason', mustSupport: true },
    ],
  },
} satisfies StructureDefinition;

describe('SD FHIRPath choice-type handling', () => {
  it('does not flag vs-3 when Observation.component has valueQuantity', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: bloodPressureObservation,
      resourceType: 'Observation',
      structureDef: vitalsProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-vs-3')).toHaveLength(0);
  });

  it('still flags vs-3 when an Observation.component has neither value[x] nor dataAbsentReason', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'bp-panel-missing-value',
        component: [{ code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] } }],
      },
      resourceType: 'Observation',
      structureDef: vitalsProfile,
      fhirVersion: 'R4',
    });

    expect(issues.some(issue => issue.code === 'constraint-violation-vs-3')).toBe(true);
  });
});

describe('SD FHIRPath array element constraint handling', () => {
  const compositionProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/composition-section',
    name: 'CompositionSection',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Composition',
    snapshot: {
      element: [
        { id: 'Composition', path: 'Composition' },
        {
          id: 'Composition.section',
          path: 'Composition.section',
          type: [{ code: 'BackboneElement' }],
          constraint: [
            {
              key: 'cmp-2',
              severity: 'error',
              human: 'A section can only have an emptyReason if it is empty',
              expression: 'emptyReason.empty() or entry.empty()',
            },
          ],
        },
      ],
    },
  } satisfies StructureDefinition;

  it('evaluates cmp-2 per section item, not on the aggregate section array', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Composition',
        status: 'final',
        section: [
          { title: 'Problems', entry: [{ reference: 'Condition/1' }] },
          {
            title: 'Procedures',
            emptyReason: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
                code: 'nilknown',
              }],
            },
          },
        ],
      },
      resourceType: 'Composition',
      structureDef: compositionProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-cmp-2')).toHaveLength(0);
  });

  it('still reports cmp-2 when the same section has entries and emptyReason', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Composition',
        status: 'final',
        section: [
          {
            title: 'Procedures',
            entry: [{ reference: 'Procedure/1' }],
            emptyReason: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
                code: 'nilknown',
              }],
            },
          },
        ],
      },
      resourceType: 'Composition',
      structureDef: compositionProfile,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-cmp-2',
      path: 'Composition.section[0]',
    }));
  });
});

describe('MustSupport choice-type handling', () => {
  it('does not request dataAbsentReason when component valueQuantity is present', async () => {
    const validator = new MustSupportValidator();
    const issues = await validator.validateAllMustSupportElements(
      bloodPressureObservation,
      vitalsProfile,
      vitalsProfile.url,
      () => undefined,
    );

    expect(issues).toHaveLength(0);
  });
});
