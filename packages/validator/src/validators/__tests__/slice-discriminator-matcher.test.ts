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
});
