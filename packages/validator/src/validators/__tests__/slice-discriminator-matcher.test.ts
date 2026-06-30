import { describe, expect, it } from 'vitest';
import { matchDiscriminator } from '../slice-discriminator-matcher';
import { codingMatchesBindingCodes, matchesPattern } from '../slice-utils';
import type { SliceDefinition } from '../slice-types';

describe('matchDiscriminator', () => {
  it('matches value $this slices by binding codes', () => {
    const element = {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-category',
        code: 'problem-list-item',
      }],
    };
    const slice: SliceDefinition = {
      sliceName: 'us-core',
      path: 'Condition.category',
      min: 1,
      max: '*',
      discriminator: [{ type: 'value', path: '$this' }],
      bindingCodes: new Set([
        'http://terminology.hl7.org/CodeSystem/condition-category|problem-list-item',
      ]),
    };

    expect(matchDiscriminator(
      element,
      slice,
      { type: 'value', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);
  });

  it('does not match system-qualified codings against bare duplicate codes from another system', () => {
    const element = {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-category',
        code: 'problem-list-item',
      }],
    };
    const slice: SliceDefinition = {
      sliceName: 'screening-assessment',
      path: 'Condition.category',
      min: 0,
      max: '*',
      discriminator: [{ type: 'value', path: '$this' }],
      bindingCodes: new Set([
        'http://terminology.hl7.org/CodeSystem/observation-category|survey',
        'problem-list-item',
      ]),
    };

    expect(matchDiscriminator(
      element,
      slice,
      { type: 'value', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('keeps bare-code matching for legacy binding expansions without systems', () => {
    const element = {
      coding: [{
        system: 'http://loinc.org',
        code: '76531-3',
      }],
    };
    const slice: SliceDefinition = {
      sliceName: 'loinc',
      path: 'Observation.code.coding',
      min: 1,
      max: '*',
      discriminator: [{ type: 'value', path: '$this' }],
      bindingCodes: new Set(['76531-3']),
    };

    expect(matchDiscriminator(
      element,
      slice,
      { type: 'value', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);
  });

  it('does not let unresolved binding-only pattern slices match everything', () => {
    const slice: SliceDefinition = {
      sliceName: 'screening-assessment',
      path: 'Condition.category',
      min: 0,
      max: '*',
      discriminator: [{ type: 'pattern', path: '$this' }],
      bindingValueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-simple-observation-category',
    };

    expect(matchDiscriminator(
      {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: 'problem-list-item',
        }],
      },
      slice,
      { type: 'pattern', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('uses Coding system and code as a stable identity for whole-Coding pattern slices', () => {
    const element = {
      system: 'http://loinc.org',
      code: '8867-4',
      version: '2.81',
      display: 'Heart rate',
    };
    const slice: SliceDefinition = {
      sliceName: 'loinc',
      path: 'Observation.code.coding',
      min: 1,
      max: '1',
      discriminator: [{ type: 'pattern', path: '$this' }],
      patternKind: 'patternCoding',
      pattern: {
        system: 'http://loinc.org',
        code: '8867-4',
        version: '2.77',
      },
    };

    expect(matchDiscriminator(
      element,
      slice,
      { type: 'pattern', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
      [slice],
    )).toBe(true);
  });

  it('does not use the Coding identity fallback when another slice matches exactly', () => {
    const element = {
      system: 'http://loinc.org',
      code: '8867-4',
      version: '2.81',
    };
    const oldVersionSlice: SliceDefinition = {
      sliceName: 'loinc-old',
      path: 'Observation.code.coding',
      min: 1,
      max: '1',
      discriminator: [{ type: 'pattern', path: '$this' }],
      patternKind: 'patternCoding',
      pattern: {
        system: 'http://loinc.org',
        code: '8867-4',
        version: '2.77',
      },
    };
    const currentVersionSlice: SliceDefinition = {
      ...oldVersionSlice,
      sliceName: 'loinc-current',
      pattern: {
        system: 'http://loinc.org',
        code: '8867-4',
        version: '2.81',
      },
    };
    const slices = [oldVersionSlice, currentVersionSlice];

    expect(matchDiscriminator(
      element,
      oldVersionSlice,
      { type: 'pattern', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
      slices,
    )).toBe(false);
    expect(matchDiscriminator(
      element,
      currentVersionSlice,
      { type: 'pattern', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
      slices,
    )).toBe(true);
  });

  it('matches resolve().ofType() discriminators against the resolved resource type', () => {
    const slice: SliceDefinition = {
      sliceName: 'observation',
      path: 'DiagnosticReport.result',
      min: 0,
      max: '*',
      discriminator: [{ type: 'type', path: 'resolve().ofType(Observation)' }],
    };

    expect(matchDiscriminator(
      { reference: 'Observation/obs-1' },
      slice,
      { type: 'type', path: 'resolve().ofType(Observation)' },
      () => ({ resourceType: 'Observation', id: 'obs-1' }),
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);
  });

  it('applies value discriminator paths after resolve() to the resolved resource', () => {
    const slice: SliceDefinition = {
      sliceName: 'final-observation',
      path: 'DiagnosticReport.result',
      min: 0,
      max: '*',
      discriminator: [{ type: 'value', path: 'resolve().status' }],
      childFixed: new Map([['status', 'final']]),
    };

    expect(matchDiscriminator(
      { reference: 'Observation/obs-1' },
      slice,
      { type: 'value', path: 'resolve().status' },
      () => ({ resourceType: 'Observation', id: 'obs-1', status: 'final' }),
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);

    expect(matchDiscriminator(
      { reference: 'Observation/obs-2' },
      slice,
      { type: 'value', path: 'resolve().status' },
      () => ({ resourceType: 'Observation', id: 'obs-2', status: 'preliminary' }),
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });
});
