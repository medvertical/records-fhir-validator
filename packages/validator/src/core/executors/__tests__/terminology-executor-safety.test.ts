import { describe, expect, it, vi } from 'vitest';

import type { ValidationIssue } from '@records-fhir/validation-types';
import type {
  ElementDefinition,
  StructureDefinition,
} from '../../structure-definition-types';
import { TerminologyExecutor } from '../terminology-executor';
import { createTerminologyValidationPortMock } from './terminology-validation-port.test-support';

function profile(elements: unknown[]): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: 'test',
    url: 'https://example.test/StructureDefinition/Test',
    name: 'Test',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: { element: elements as ElementDefinition[] },
  };
}

function bindingElement(path: string): ElementDefinition {
  return {
    path,
    min: 0,
    max: '1',
    type: [{ code: 'code' }],
    binding: {
      strength: 'required',
      valueSet: 'https://example.test/ValueSet/test',
    },
  };
}

describe('TerminologyExecutor safety', () => {
  it('preserves successful binding results after another element throws', async () => {
    const terminology = createTerminologyValidationPortMock();
    const executor = new TerminologyExecutor(terminology);
    const expectedIssue: ValidationIssue = {
      id: 'valid-result',
      aspect: 'terminology',
      severity: 'error',
      code: 'binding-violation',
      message: 'Invalid code',
      path: 'Observation.code',
      timestamp: new Date(),
    };
    terminology.validateBinding.mockResolvedValue([expectedIssue]);

    const issues = await executor.validate({
      resource: {
        resourceType: 'Observation',
        status: 'invalid',
        code: 'invalid',
      },
      structureDef: profile([
        bindingElement('Observation.status'),
        bindingElement('Observation.code'),
      ]),
      getValueAtPath: (resource, path) => {
        if (path === 'Observation.status') throw new Error('service timeout');
        return (resource as Record<string, unknown>).code;
      },
    });

    expect(issues).toContainEqual(expectedIssue);
    expect(issues.filter(issue => issue.code === 'validation-error')).toEqual([
      expect.objectContaining({
        path: 'Observation.status',
        details: expect.objectContaining({
          fieldPath: 'Observation.status',
        }),
        message:
          'Terminology validation could not be completed because the validator encountered an operational error.',
      }),
    ]);
    expect(JSON.stringify(issues)).not.toContain('service timeout');
  });

  it('deduplicates identical technical failures while continuing all elements', async () => {
    const executor = new TerminologyExecutor();
    const getter = vi.fn(() => {
      throw new Error('shared failure');
    });

    const issues = await executor.validate({
      resource: { resourceType: 'Observation' },
      structureDef: profile([
        bindingElement('Observation.status'),
        bindingElement('Observation.code'),
      ]),
      getValueAtPath: getter,
    });

    expect(getter).toHaveBeenCalledTimes(2);
    expect(
      issues.filter(issue => issue.code === 'validation-error'),
    ).toHaveLength(1);
  });

  it('skips malformed snapshot elements before contentReference expansion', async () => {
    const executor = new TerminologyExecutor();
    const cyclic: Record<string, unknown> = {};
    cyclic.contentReference = cyclic;

    const issues = await executor.validate({
      resource: { resourceType: 'Observation' },
      structureDef: profile([
        null,
        42,
        {},
        { path: Symbol('Observation.status') },
        cyclic,
      ]),
      getValueAtPath: () => undefined,
    });

    expect(issues.filter(issue => issue.code === 'validation-error')).toEqual(
      [],
    );
  });

  it('surfaces an unavailable additional conformance ValueSet as incomplete coverage', async () => {
    const executor = new TerminologyExecutor();
    executor.configureResolution({
      strategy: 'local-only',
      reportUnverifiedBindings: true,
      strictUnverifiedRequiredBindings: true,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const additionalValueSet =
      'http://terminology.example/ValueSet/cross-border';
    const issues = await executor.validate({
      resource: {
        resourceType: 'Observation',
        code: {
          coding: [
            { system: 'http://example.org/CodeSystem/test', code: '123' },
          ],
        },
      },
      structureDef: profile([
        {
          path: 'Observation.code',
          min: 1,
          max: '1',
          type: [{ code: 'CodeableConcept' }],
          binding: {
            strength: 'example',
            valueSet: 'http://example.org/ValueSet/example-only',
            extension: [
              {
                url: 'http://hl7.org/fhir/tools/StructureDefinition/additional-binding',
                extension: [
                  { url: 'purpose', valueCode: 'preferred' },
                  { url: 'valueSet', valueCanonical: additionalValueSet },
                ],
              },
            ],
          },
        },
      ]),
      getValueAtPath: resource => (resource as Record<string, unknown>).code,
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aspect: 'terminology',
          severity: 'warning',
          code: 'terminology-binding-unverified',
          path: 'Observation.code',
          details: expect.objectContaining({
            valueSet: additionalValueSet,
            validationStatus: 'incomplete',
            reason: 'binding-unverified',
          }),
        }),
      ]),
    );
  });

  it('surfaces an unavailable additional ValueSet for a text-only CodeableConcept', async () => {
    const executor = new TerminologyExecutor();
    executor.configureResolution({
      strategy: 'local-only',
      reportUnverifiedBindings: true,
      strictUnverifiedRequiredBindings: true,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const additionalValueSet = 'http://terminology.example/ValueSet/reaction';
    const issues = await executor.validate({
      resource: {
        resourceType: 'AllergyIntolerance',
        reaction: [{ manifestation: [{ text: 'Urticaria' }] }],
      },
      structureDef: profile([
        {
          path: 'AllergyIntolerance.reaction.manifestation',
          min: 1,
          max: '*',
          type: [{ code: 'CodeableConcept' }],
          binding: {
            strength: 'example',
            valueSet: 'http://example.org/ValueSet/example-only',
            extension: [
              {
                url: 'http://hl7.org/fhir/tools/StructureDefinition/additional-binding',
                extension: [
                  { url: 'purpose', valueCode: 'preferred' },
                  { url: 'valueSet', valueCanonical: additionalValueSet },
                ],
              },
            ],
          },
        },
      ]),
      getValueAtPath: () => [{ text: 'Urticaria' }],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aspect: 'terminology',
          severity: 'warning',
          code: 'terminology-valueset-unavailable',
          path: 'AllergyIntolerance.reaction[0].manifestation[0]',
          details: expect.objectContaining({
            valueSet: additionalValueSet,
            validationStatus: 'incomplete',
            reason: 'valueset-unavailable',
          }),
        }),
      ]),
    );
  });
});
