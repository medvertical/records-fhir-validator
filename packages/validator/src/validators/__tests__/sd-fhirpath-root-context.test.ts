import { describe, expect, it } from 'vitest';

import type { StructureDefinition } from '../../core/structure-definition-types';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';

const executor = new SDFHIRPathExecutor();

describe('SDFHIRPathExecutor resource-root variables', () => {
  it('binds Bundle entry resource constraints to the entry resource and Bundle roots', async () => {
    const structureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/bundle-context',
      name: 'BundleContext',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Bundle',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle' },
          {
            id: 'Bundle.entry.resource',
            path: 'Bundle.entry.resource',
            type: [{ code: 'Resource' }],
            constraint: [{
              key: 'variables-test',
              severity: 'error',
              human: 'Check context variables are set correctly',
              expression: "%context.type().name = 'Patient' and %resource.type().name = 'Bundle' and %rootResource.type().name = 'Bundle'",
            }],
          },
        ],
      },
    };

    const issues = await executor.execute({
      resource: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: { resourceType: 'Patient', gender: 'male' } },
          { resource: { resourceType: 'Patient', gender: 'female' } },
        ],
      },
      resourceType: 'Bundle',
      structureDef,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.ruleId === 'variables-test')).toHaveLength(0);
  });

  it('binds resource to the nearest contained resource for nested datatype constraints', async () => {
    const structureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/contained-context',
      name: 'ContainedContext',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          { id: 'Patient', path: 'Patient' },
          { id: 'Patient.contained', path: 'Patient.contained', type: [{ code: 'Resource' }] },
          {
            id: 'Patient.contained.name',
            path: 'Patient.contained.name',
            type: [{ code: 'HumanName' }],
            constraint: [{
              key: 'contained-context',
              severity: 'error',
              human: 'Check context variables are set correctly',
              expression: "%context.type().name = 'HumanName' and %resource.type().name = 'Practitioner' and %rootResource.type().name = 'Patient'",
            }],
          },
        ],
      },
    };

    const issues = await executor.execute({
      resource: {
        resourceType: 'Patient',
        contained: [{
          resourceType: 'Practitioner',
          id: 'practitioner-1',
          name: [{ text: 'Dr Malaprop' }],
        }],
      },
      resourceType: 'Patient',
      structureDef,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.ruleId === 'contained-context')).toHaveLength(0);
  });

  it('preserves the outer root when validating a contained resource recursively', async () => {
    const structureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/contained-practitioner-context',
      name: 'ContainedPractitionerContext',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Practitioner',
      snapshot: {
        element: [
          { id: 'Practitioner', path: 'Practitioner' },
          {
            id: 'Practitioner.name',
            path: 'Practitioner.name',
            type: [{ code: 'HumanName' }],
            constraint: [{
              key: 'recursive-contained-context',
              severity: 'error',
              human: 'Check recursive contained-resource context variables',
              expression: "%context.type().name = 'HumanName' and %resource.type().name = 'Practitioner' and %rootResource.type().name = 'Patient'",
            }],
          },
        ],
      },
    };

    const issues = await executor.execute({
      resource: {
        resourceType: 'Practitioner',
        id: 'practitioner-1',
        name: [{ text: 'Dr Malaprop' }],
      },
      rootResource: {
        resourceType: 'Patient',
        contained: [{
          resourceType: 'Practitioner',
          id: 'practitioner-1',
          name: [{ text: 'Dr Malaprop' }],
        }],
      },
      resourceType: 'Practitioner',
      structureDef,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.ruleId === 'recursive-contained-context')).toHaveLength(0);
  });

  it('keeps resource and rootResource distinct when the scoped value is not a resource', async () => {
    const structureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/extension-context',
      name: 'ExtensionContext',
      status: 'active',
      kind: 'complex-type',
      abstract: false,
      type: 'Extension',
      snapshot: {
        element: [
          { id: 'Extension', path: 'Extension' },
          {
            id: 'Extension.url',
            path: 'Extension.url',
            type: [{ code: 'uri' }],
            constraint: [{
              key: 'extension-root-context',
              severity: 'error',
              human: 'Check datatype resource-root context variables',
              expression: "%context.type().name = 'uri' and %resource.type().name = 'Extension' and %rootResource.type().name = 'Patient'",
            }],
          },
        ],
      },
    };

    const issues = await executor.execute({
      resource: { url: 'http://example.org/fhir/StructureDefinition/example' },
      rootResource: { resourceType: 'Patient', id: 'patient-1' },
      resourceType: 'Extension',
      structureDef,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.ruleId === 'extension-root-context')).toHaveLength(0);
  });

  it('resolves same-type contained scopes from the current resource before the outer root', async () => {
    const structureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/nested-contained-context',
      name: 'NestedContainedContext',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          { id: 'Patient', path: 'Patient' },
          {
            id: 'Patient.contained',
            path: 'Patient.contained',
            type: [{ code: 'Resource' }],
            constraint: [{
              key: 'same-type-contained-context',
              severity: 'error',
              human: 'Check same-type contained context variables',
              expression: "%context.type().name = 'Organization' and %resource.type().name = 'Patient' and %rootResource.type().name = 'Patient'",
            }],
          },
        ],
      },
    };
    const containedPatient = {
      resourceType: 'Patient',
      id: 'patient-contained',
      contained: [{ resourceType: 'Organization', id: 'organization-1' }],
    };

    const issues = await executor.execute({
      resource: containedPatient,
      rootResource: {
        resourceType: 'Patient',
        id: 'patient-root',
        contained: [containedPatient],
      },
      resourceType: 'Patient',
      structureDef,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.ruleId === 'same-type-contained-context')).toHaveLength(0);
  });
});
