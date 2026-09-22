import { describe, expect, it } from 'vitest';

import {
  FHIR_SCHEMA_RUNTIME_POLICY,
  isFhirSchemaDefaultRuntimeEnabled,
} from '../index';
import { convertToFHIRSchema } from '../sd-to-fhir-schema';
import { compileFHIRSchemaToValidationGraph } from '../validation-graph-compiler';
import { validateResourceWithGraph } from '../validation-graph-executor';
import type { ValidationGraph, ValidationGraphNode } from '../validation-graph-types';

describe('FHIR Schema validation graph', () => {
  it('reports cyclic graph nodes instead of overflowing the call stack', () => {
    const node: ValidationGraphNode = {
      path: 'Patient.child',
      schemaPath: 'Patient.child',
      name: 'child',
      source: { schemaUrl: 'test', schemaType: 'Patient' },
    };
    node.children = [node];
    const graph: ValidationGraph = {
      url: 'test',
      name: 'CyclicPatient',
      type: 'Patient',
      nodes: [node],
      stats: {
        nodeCount: 1,
        sliceNodeCount: 0,
        maxDepth: 1,
        requiredCount: 0,
        choiceCount: 0,
        fixedPatternCount: 0,
        bindingCount: 0,
        referenceCount: 0,
        constraintCount: 0,
        slicingCount: 0,
      },
    };

    expect(validateResourceWithGraph({ child: { child: {} } }, graph))
      .toContainEqual(expect.objectContaining({ code: 'structural-validation-graph-cycle' }));
  });

  it('keeps the graph path explicitly evidence-only', () => {
    expect(isFhirSchemaDefaultRuntimeEnabled()).toBe(false);
    expect(FHIR_SCHEMA_RUNTIME_POLICY.mode).toBe('evidence-only');
    expect(FHIR_SCHEMA_RUNTIME_POLICY.promotionRequires).toContain('java-operationoutcome-confirmation');
    expect(FHIR_SCHEMA_RUNTIME_POLICY.promotionRequires).toContain('no-open-dual-path-gate-failures');
  });

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

  it('reports fixed URI mismatches in profiled extension values', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ProcedureStellungZurOp',
      name: 'ProcedureStellungZurOp',
      type: 'Procedure',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Procedure', min: 0, max: '*' },
          {
            id: 'Procedure.extension',
            path: 'Procedure.extension',
            min: 0,
            max: '*',
            type: [{ code: 'Extension' }],
            slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' },
          },
          {
            id: 'Procedure.extension:StellungZurOp',
            path: 'Procedure.extension',
            sliceName: 'StellungZurOp',
            min: 0,
            max: '*',
            type: [{ code: 'Extension' }],
          },
          {
            id: 'Procedure.extension:StellungZurOp.url',
            path: 'Procedure.extension.url',
            min: 1,
            max: '1',
            type: [{ code: 'uri' }],
            fixedUri: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/StructureDefinition/mii-ex-onko-systemische-therapie-stellungzurop',
          },
          {
            id: 'Procedure.extension:StellungZurOp.value[x]',
            path: 'Procedure.extension.value[x]',
            min: 0,
            max: '1',
            type: [{ code: 'CodeableConcept' }],
          },
          {
            id: 'Procedure.extension:StellungZurOp.value[x].coding',
            path: 'Procedure.extension.value[x].coding',
            min: 0,
            max: '*',
            type: [{ code: 'Coding' }],
          },
          {
            id: 'Procedure.extension:StellungZurOp.value[x].coding.system',
            path: 'Procedure.extension.value[x].coding.system',
            min: 1,
            max: '1',
            type: [{ code: 'uri' }],
            fixedUri: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/CodeSystem/mii-cs-therapie-stellungzurop',
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);
    const resource = {
      resourceType: 'Procedure',
      extension: [{
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/StructureDefinition/mii-ex-onko-systemische-therapie-stellungzurop',
        valueCodeableConcept: {
          coding: [{
            system: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/CodeSystem/mii-cs-onko-therapie-stellungzurop',
            code: 'A',
          }],
        },
      }],
    };

    const issues = validateResourceWithGraph(resource, graph);
    const matchingIssues = validateResourceWithGraph({
      ...resource,
      extension: [{
        ...resource.extension[0],
        valueCodeableConcept: {
          coding: [{
            system: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/CodeSystem/mii-cs-therapie-stellungzurop',
            code: 'A',
          }],
        },
      }],
    }, graph);

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-fixed-value-mismatch',
      path: 'Procedure.extension:StellungZurOp.value.coding.system',
    }));
    expect(matchingIssues.find(issue => issue.code === 'profile-fixed-value-mismatch')).toBeUndefined();
  });

  it('counts primitive sidecar extensions as present for required primitive elements', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/MaskedPatient',
      name: 'MaskedPatient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          {
            id: 'Patient.identifier',
            path: 'Patient.identifier',
            min: 0,
            max: '*',
            type: [{ code: 'Identifier' }],
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
          },
          {
            id: 'Patient.identifier:masked',
            path: 'Patient.identifier',
            sliceName: 'masked',
            min: 0,
            max: '1',
            type: [{ code: 'Identifier' }],
            patternIdentifier: {
              type: {
                coding: [{
                  system: 'http://fhir.de/CodeSystem/identifier-type-de-basis',
                  code: 'KVZ10',
                }],
              },
            },
          },
          {
            id: 'Patient.identifier:masked.value',
            path: 'Patient.identifier.value',
            min: 1,
            max: '1',
            type: [{ code: 'string' }],
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);
    const maskedIdentifier = {
      type: {
        coding: [{
          system: 'http://fhir.de/CodeSystem/identifier-type-de-basis',
          code: 'KVZ10',
        }],
      },
      _value: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'masked',
        }],
      },
    };

    const issues = validateResourceWithGraph({
      resourceType: 'Patient',
      identifier: [maskedIdentifier],
    }, graph);
    const idSidecarIssues = validateResourceWithGraph({
      resourceType: 'Patient',
      identifier: [{
        type: maskedIdentifier.type,
        _value: { id: 'masked-value' },
      }],
    }, graph);
    const missingIssues = validateResourceWithGraph({
      resourceType: 'Patient',
      identifier: [{ type: maskedIdentifier.type }],
    }, graph);
    const emptySidecarIssues = validateResourceWithGraph({
      resourceType: 'Patient',
      identifier: [{
        type: maskedIdentifier.type,
        _value: {},
      }],
    }, graph);
    const emptyExtensionSidecarIssues = validateResourceWithGraph({
      resourceType: 'Patient',
      identifier: [{
        type: maskedIdentifier.type,
        _value: { extension: [] },
      }],
    }, graph);

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'structural-required-element-missing',
      path: 'Patient.identifier:masked.value',
    }));
    expect(idSidecarIssues).not.toContainEqual(expect.objectContaining({
      code: 'structural-required-element-missing',
      path: 'Patient.identifier:masked.value',
    }));
    expect(missingIssues).toContainEqual(expect.objectContaining({
      code: 'structural-required-element-missing',
      path: 'Patient.identifier:masked.value',
    }));
    expect(emptySidecarIssues).toContainEqual(expect.objectContaining({
      code: 'structural-required-element-missing',
      path: 'Patient.identifier:masked.value',
    }));
    expect(emptyExtensionSidecarIssues).toContainEqual(expect.objectContaining({
      code: 'structural-required-element-missing',
      path: 'Patient.identifier:masked.value',
    }));
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

  it('does not count broad forbidden slices when a more specific allowed sibling matches', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationBroadForbiddenSliceProfile',
      name: 'ObservationBroadForbiddenSliceProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
          {
            path: 'Observation.code.coding',
            min: 2,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
          },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 1,
            max: '1',
            patternCoding: { system: 'http://loinc.org', code: '8310-5' },
          },
          {
            id: 'Observation.code.coding:coretemp-loinc',
            path: 'Observation.code.coding',
            sliceName: 'coretemp-loinc',
            min: 1,
            max: '1',
            patternCoding: { system: 'http://loinc.org', code: '8329-5' },
          },
          {
            id: 'Observation.code.coding:specific-loinc',
            path: 'Observation.code.coding',
            sliceName: 'specific-loinc',
            min: 0,
            max: '0',
            patternCoding: { system: 'http://loinc.org' },
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const validIssues = validateResourceWithGraph({
      resourceType: 'Observation',
      code: {
        coding: [
          { system: 'http://loinc.org', code: '8310-5' },
          { system: 'http://loinc.org', code: '8329-5' },
        ],
      },
    }, graph);
    expect(validIssues).not.toContainEqual(expect.objectContaining({
      code: 'profile-slice-max-cardinality',
      path: 'Observation.code.coding',
    }));

    const invalidIssues = validateResourceWithGraph({
      resourceType: 'Observation',
      code: {
        coding: [
          { system: 'http://loinc.org', code: '8310-5' },
          { system: 'http://loinc.org', code: '9999-9' },
        ],
      },
    }, graph);
    expect(invalidIssues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-max-cardinality',
      path: 'Observation.code.coding',
    }));
  });

  it('does not report unmatchable whole-element $this slices from child-only patterns', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationChildOnlyThisSliceProfile',
      name: 'ObservationChildOnlyThisSliceProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 1,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
          },
          {
            id: 'Observation.code.coding:sct',
            path: 'Observation.code.coding',
            sliceName: 'sct',
            min: 1,
            max: '1',
          },
          {
            id: 'Observation.code.coding:sct.code',
            path: 'Observation.code.coding.code',
            min: 1,
            max: '1',
            patternCode: '271625008',
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const issues = validateResourceWithGraph({
      resourceType: 'Observation',
      code: {
        coding: [
          { system: 'http://snomed.info/sct', code: '271625008' },
        ],
      },
    }, graph);

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-slice-min-cardinality',
      path: 'Observation.code.coding',
    }));
  });

  it('leaves required resolve() slices unverified when no target can be reached', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationFocusResolveProfile',
      name: 'ObservationFocusResolveProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            id: 'Observation.focus',
            path: 'Observation.focus',
            min: 2,
            max: '*',
            type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Resource'] }],
            slicing: { discriminator: [{ type: 'profile', path: 'resolve()' }], rules: 'open' },
          },
          {
            id: 'Observation.focus:Diagnose',
            path: 'Observation.focus',
            sliceName: 'Diagnose',
            min: 1,
            max: '1',
            type: [{ code: 'Reference', targetProfile: ['http://example.org/StructureDefinition/Diagnosis'] }],
          },
          {
            id: 'Observation.focus:Operation',
            path: 'Observation.focus',
            sliceName: 'Operation',
            min: 1,
            max: '1',
            type: [{ code: 'Reference', targetProfile: ['http://example.org/StructureDefinition/Operation'] }],
          },
        ],
      },
    }, url => ({
      url,
      name: url.split('/').at(-1) ?? 'Profile',
      type: url.endsWith('/Operation') ? 'Procedure' : 'Condition',
      kind: 'resource',
      snapshot: { element: [] },
    }));
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const resource = {
      resourceType: 'Observation',
      focus: [
        { reference: 'Condition/example' },
        { reference: 'Procedure/example' },
      ],
    };

    // Without a resolver the targets decide nothing, so neither slice may be
    // declared missing on the strength of evidence that was never gathered.
    expect(validateResourceWithGraph(resource, graph)
      .filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(0);

    const targets: Record<string, unknown> = {
      'Condition/example': {
        resourceType: 'Condition',
        meta: { profile: ['http://example.org/StructureDefinition/Diagnosis'] },
      },
      'Procedure/example': {
        resourceType: 'Procedure',
        meta: { profile: ['http://example.org/StructureDefinition/Operation'] },
      },
    };
    expect(validateResourceWithGraph(resource, graph, {
      resolveReference: reference => targets[reference] ?? null,
    }).filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(0);

    expect(validateResourceWithGraph(resource, graph, {
      resolveReference: () => ({ resourceType: 'Condition', meta: { profile: ['http://example.org/other'] } }),
    }).filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(2);
  });

  it('decides closed resolve() slices from the resolved target', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/DiagnosticReportResolveProfile',
      name: 'DiagnosticReportResolveProfile',
      type: 'DiagnosticReport',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'DiagnosticReport', min: 0, max: '*' },
          {
            id: 'DiagnosticReport.result',
            path: 'DiagnosticReport.result',
            min: 1,
            max: '*',
            type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Observation'] }],
            slicing: { discriminator: [{ type: 'value', path: 'resolve().code' }], rules: 'closed' },
          },
          {
            id: 'DiagnosticReport.result:diagnostic-conclusion',
            path: 'DiagnosticReport.result',
            sliceName: 'diagnostic-conclusion',
            min: 1,
            max: '1',
            type: [{ code: 'Reference', targetProfile: ['http://example.org/StructureDefinition/DiagnosticConclusion'] }],
          },
        ],
      },
    }, url => ({
      url,
      name: 'DiagnosticConclusion',
      type: 'Observation',
      kind: 'resource',
      snapshot: { element: [] },
    }));
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const resource = {
      resourceType: 'DiagnosticReport',
      result: [
        { reference: 'Observation/a' },
        { reference: 'Observation/b' },
      ],
    };

    expect(validateResourceWithGraph(resource, graph).map(issue => issue.code))
      .not.toContain('profile-slice-min-cardinality');

    const conclusion = {
      resourceType: 'Observation',
      meta: { profile: ['http://example.org/StructureDefinition/DiagnosticConclusion'] },
    };
    const satisfied = validateResourceWithGraph(resource, graph, {
      resolveReference: reference => (reference === 'Observation/a' ? conclusion : { resourceType: 'Observation' }),
    }).map(issue => issue.code);
    expect(satisfied).not.toContain('profile-slice-min-cardinality');
    // 'Observation/b' resolves but fits no slice, which closed slicing forbids.
    expect(satisfied).toContain('profile-pattern-mismatch');

    const unsatisfied = validateResourceWithGraph(resource, graph, {
      resolveReference: () => ({ resourceType: 'Observation' }),
    }).map(issue => issue.code);
    expect(unsatisfied).toContain('profile-slice-min-cardinality');
    expect(unsatisfied).toContain('profile-pattern-mismatch');
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

  it('validates core Reference target types from graph refers metadata', () => {
    const schema = convertToFHIRSchema({
      url: 'http://example.org/StructureDefinition/ObservationReferenceProfile',
      name: 'ObservationReferenceProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            path: 'Observation.subject',
            min: 1,
            max: '1',
            type: [{
              code: 'Reference',
              targetProfile: [
                'http://hl7.org/fhir/StructureDefinition/Patient',
                'http://hl7.org/fhir/StructureDefinition/Group',
              ],
            }],
          },
        ],
      },
    });
    const graph = compileFHIRSchemaToValidationGraph(schema);

    const validIssues = validateResourceWithGraph({
      resourceType: 'Observation',
      subject: { reference: 'Patient/example' },
    }, graph);
    const invalidIssues = validateResourceWithGraph({
      resourceType: 'Observation',
      subject: { reference: 'Organization/example' },
    }, graph);

    expect(validIssues).toHaveLength(0);
    expect(invalidIssues.map(issue => issue.code)).toContain('reference-target-type-invalid');
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
