import { describe, expect, it } from 'vitest';

import { convertToFHIRSchema } from '../sd-to-fhir-schema';
import { compileFHIRSchemaToValidationGraph } from '../validation-graph-compiler';
import { validateResourceWithGraph } from '../validation-graph-executor';

describe('FHIR Schema validation graph slicing', () => {
  it('matches parent slices only against configured discriminator child paths', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationComponentDiscriminatorProfile',
      name: 'ObservationComponentDiscriminatorProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          {
            id: 'Observation.component',
            path: 'Observation.component',
            min: 0,
            max: '*',
            type: [{ code: 'BackboneElement' }],
            slicing: { discriminator: [{ type: 'pattern', path: 'code' }], rules: 'open' },
          },
          {
            id: 'Observation.component:SystolicBP',
            path: 'Observation.component',
            sliceName: 'SystolicBP',
            min: 1,
            max: '1',
          },
          {
            id: 'Observation.component:SystolicBP.code',
            path: 'Observation.component.code',
            min: 1,
            max: '1',
            patternCodeableConcept: {
              coding: [{ system: 'http://loinc.org', code: '8480-6' }],
            },
          },
          {
            id: 'Observation.component:SystolicBP.value[x]',
            path: 'Observation.component.value[x]',
            min: 0,
            max: '1',
            type: [{ code: 'Quantity' }],
            patternQuantity: {
              system: 'http://unitsofmeasure.org',
              code: 'mm[Hg]',
            },
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      component: [{
        code: {
          coding: [{ system: 'http://loinc.org', code: '8480-6' }],
        },
        valueQuantity: {
          value: 120,
          system: 'http://unitsofmeasure.org',
          code: 'mm[Hg]',
        },
      }],
    }, graph);

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-slice-min-cardinality',
      path: 'Observation.component',
    }));
  });
});
