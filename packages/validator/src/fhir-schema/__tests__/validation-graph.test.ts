import { describe, expect, it } from 'vitest';

import { convertToFHIRSchema } from '../sd-to-fhir-schema';
import { compileFHIRSchemaToValidationGraph } from '../validation-graph-compiler';
import { validateResourceWithGraph } from '../validation-graph-executor';

describe('FHIR Schema validation graph', () => {
  it('compiles schema elements, choices, fixed values, patterns, and slices into graph nodes', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationProfile',
      name: 'ObservationProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          { id: 'Observation.status', path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }], fixedCode: 'final' },
          {
            id: 'Observation.value[x]',
            path: 'Observation.value[x]',
            min: 0,
            max: '1',
            type: [{ code: 'Quantity' }, { code: 'string' }],
            patternQuantity: { system: 'http://unitsofmeasure.org' },
          },
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
            min: 1,
            max: '1',
            sliceName: 'SystolicBP',
          },
        ],
      },
    });

    const graph = compileFHIRSchemaToValidationGraph(schema);

    expect(graph.type).toBe('Observation');
    expect(graph.stats.nodeCount).toBeGreaterThanOrEqual(4);
    expect(graph.stats.choiceCount).toBe(1);
    expect(graph.stats.fixedPatternCount).toBe(2);
    expect(graph.stats.sliceNodeCount).toBe(1);
    expect(graph.nodes.find(node => node.path === 'Observation.value')?.choices).toEqual([
      'valueQuantity',
      'valueString',
    ]);
    expect(graph.nodes.find(node => node.path === 'Observation.component')?.children?.[0].path).toBe(
      'Observation.component:SystolicBP',
    );
  });

  it('validates required, fixed, pattern, and choice rules from the graph', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationProfile',
      name: 'ObservationProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }], fixedCode: 'final' },
          {
            path: 'Observation.value[x]',
            min: 0,
            max: '1',
            type: [{ code: 'Quantity' }, { code: 'string' }],
            patternQuantity: { system: 'http://unitsofmeasure.org' },
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      status: 'registered',
      valueQuantity: { value: 12 },
      valueString: 'duplicate choice',
    }, graph);

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'profile-fixed-value-mismatch',
      'structural-choice-multiple',
      'profile-pattern-mismatch',
    ]));
  });

  it('matches object patterns inside arrays as subset semantics', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationBodySiteProfile',
      name: 'ObservationBodySiteProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            path: 'Observation.bodySite',
            min: 0,
            max: '1',
            type: [{ code: 'CodeableConcept' }],
            patternCodeableConcept: {
              coding: [{ system: 'http://snomed.info/sct', code: '91470000' }],
            },
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      bodySite: {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: '91470000',
            display: 'Axillary region structure',
          },
        ],
      },
    }, graph);

    expect(issues).toHaveLength(0);
  });

  it('recognizes concrete FHIR choice properties when schema choices are implicit', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationImplicitChoiceProfile',
      name: 'ObservationImplicitChoiceProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            path: 'Observation.value[x]',
            min: 1,
            max: '1',
            patternQuantity: { system: 'http://unitsofmeasure.org' },
          },
          {
            path: 'Observation.value[x].unit',
            min: 1,
            max: '1',
          },
          {
            path: 'Observation.value[x].code',
            patternCode: '/min',
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      valueQuantity: {
        value: 70,
        unit: 'beats per minute',
        system: 'http://unitsofmeasure.org',
        code: '/min',
      },
    }, graph);

    expect(issues).toHaveLength(0);
  });

  it('validates pattern-based array slices', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationSliceProfile',
      name: 'ObservationSliceProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
          {
            path: 'Observation.code.coding',
            min: 1,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'closed' },
          },
          {
            id: 'Observation.code.coding:sct',
            path: 'Observation.code.coding',
            sliceName: 'sct',
            min: 1,
            max: '1',
            patternCoding: { system: 'http://snomed.info/sct', code: '123' },
          },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 0,
            max: '0',
            patternCoding: { system: 'http://loinc.org' },
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      code: {
        coding: [
          { system: 'http://loinc.org', code: 'forbidden' },
          { system: 'http://example.org', code: 'unknown' },
        ],
      },
    }, graph);

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'profile-slice-min-cardinality',
      'profile-slice-max-cardinality',
      'profile-pattern-mismatch',
    ]));
  });

  it('keeps inherited slice cardinalities isolated when merging differentials', () => {
    const baseProfile = {
      url: 'http://example.org/StructureDefinition/BaseObservation',
      name: 'BaseObservation',
      type: 'Observation',
      kind: 'resource',
      differential: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 1,
            max: '*',
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
          },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 0,
            max: '*',
            patternCoding: { system: 'http://loinc.org' },
          },
          {
            id: 'Observation.code.coding:IEEE-11073',
            path: 'Observation.code.coding',
            sliceName: 'IEEE-11073',
            min: 0,
            max: '*',
            patternCoding: { system: 'urn:iso:std:iso:11073:10101' },
          },
        ],
      },
    };
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/DerivedObservation',
      name: 'DerivedObservation',
      type: 'Observation',
      kind: 'resource',
      baseDefinition: baseProfile.url,
      differential: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 1,
            max: '1',
            patternCoding: { system: 'http://loinc.org', code: '76297-1' },
          },
          {
            id: 'Observation.code.coding:IEEE-11073',
            path: 'Observation.code.coding',
            sliceName: 'IEEE-11073',
            patternCoding: { system: 'urn:iso:std:iso:11073:10101', code: '150636' },
          },
        ],
      },
    }, url => (url === baseProfile.url ? baseProfile : undefined));
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      code: {
        coding: [
          { system: 'http://loinc.org', code: '76297-1' },
        ],
      },
    }, graph);

    expect(issues).toHaveLength(0);
    const codingNode = graph.nodes
      .find(node => node.path === 'Observation.code')
      ?.children?.find(node => node.path === 'Observation.code.coding');
    expect(codingNode?.children?.find(node => node.sliceName === 'loinc')?.min).toBe(1);
    expect(codingNode?.children?.find(node => node.sliceName === 'IEEE-11073')?.min).toBe(0);
  });

  it('matches object patterns against repeated child values', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationCodeProfile',
      name: 'ObservationCodeProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
          {
            id: 'Observation.code',
            path: 'Observation.code',
            patternCodeableConcept: {
              coding: [{ system: 'http://loinc.org', code: '1234-5' }],
            },
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      code: {
        coding: [
          { system: 'http://snomed.info/sct', code: '111' },
          { system: 'http://loinc.org', code: '1234-5' },
        ],
      },
    }, graph);

    expect(issues).toHaveLength(0);
  });

  it('validates child rules inside matched parent slices', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationComponentSliceProfile',
      name: 'ObservationComponentSliceProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
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
            id: 'Observation.component:SystolicBP.code.coding',
            path: 'Observation.component.code.coding',
            min: 2,
            max: '*',
            type: [{ code: 'Coding' }],
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
      }],
    }, graph);

    expect(issues.map(issue => issue.code)).toContain('structural-required-element-missing');
    expect(issues.map(issue => issue.path)).toContain('Observation.component:SystolicBP.code.coding');
  });

  it('does not enforce child required fields when the optional parent is absent', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/PatientProfile',
      name: 'PatientProfile',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.contact', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
          { path: 'Patient.contact.name', min: 1, max: '1', type: [{ code: 'HumanName' }] },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({ resourceType: 'Patient' }, graph);

    expect(issues).toHaveLength(0);
  });
});
