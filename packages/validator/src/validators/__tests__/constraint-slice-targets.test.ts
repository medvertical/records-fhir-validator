import { describe, expect, it } from 'vitest';

import type { ElementDefinition } from '../../core/structure-definition-types';
import { createSliceDefinitionMatcher, targetMatchesSliceDefinition } from '../constraint-slice-targets';

describe.each([
  { name: 'direct', matches: targetMatchesSliceDefinition },
  { name: 'prepared', matches: ((value, element, elements, context) =>
    createSliceDefinitionMatcher(elements)(value, element, context)) as typeof targetMatchesSliceDefinition },
])('$name constraint slice target matching', ({ matches }) => {
  it('treats fixed complex values as exact rather than partial patterns', () => {
    const slice: ElementDefinition = {
      id: 'Patient.identifier:fixed',
      path: 'Patient.identifier',
      sliceName: 'fixed',
      fixedIdentifier: {
        system: 'http://example.org/system',
      },
    };

    expect(matches(
      {
        system: 'http://example.org/system',
        value: 'extra',
      },
      slice,
      [slice],
    )).toBe(false);
  });

  it('keeps pattern complex values partial', () => {
    const slice: ElementDefinition = {
      id: 'Patient.identifier:pattern',
      path: 'Patient.identifier',
      sliceName: 'pattern',
      patternIdentifier: {
        system: 'http://example.org/system',
      },
    };

    expect(matches(
      {
        system: 'http://example.org/system',
        value: 'allowed-extra',
      },
      slice,
      [slice],
    )).toBe(true);
  });

  it('uses child constraints and ignores malformed sibling definitions', () => {
    const slice: ElementDefinition = {
      id: 'Patient.identifier:insurance',
      path: 'Patient.identifier',
      sliceName: 'insurance',
    };
    const child: ElementDefinition = {
      id: 'Patient.identifier:insurance.type',
      path: 'Patient.identifier.type',
      patternCodeableConcept: {
        coding: [{ system: 'http://example.org/type', code: 'insurance' }],
      },
    };
    const elements = [
      null,
      { id: 42 },
      slice,
      child,
    ] as unknown as ElementDefinition[];

    expect(matches(
      {
        type: {
          coding: [
            { system: 'http://example.org/type', code: 'other' },
            { system: 'http://example.org/type', code: 'insurance' },
          ],
        },
      },
      slice,
      elements,
    )).toBe(true);
  });

  it('matches versioned actual canonicals against an unversioned fixed canonical', () => {
    const slice: ElementDefinition = {
      id: 'Patient.meta.profile:expected',
      path: 'Patient.meta.profile',
      sliceName: 'expected',
      fixedCanonical: 'http://example.org/StructureDefinition/patient',
    };

    expect(matches(
      'http://example.org/StructureDefinition/patient|1.0.0',
      slice,
      [slice],
    )).toBe(true);
  });
});

describe('prepared constraint slice matching', () => {
  it('keeps nested slice conditions separate and evaluates each resource context afresh', () => {
    const parent: ElementDefinition = { id: 'Patient.address:postal', path: 'Patient.address', sliceName: 'postal' };
    const nested: ElementDefinition = { id: 'Patient.address:postal.extension:district',
      path: 'Patient.address.extension', sliceName: 'district' };
    const elements: ElementDefinition[] = [parent, nested,
      { id: `${parent.id}.type`, path: 'Patient.address.type', fixedCode: 'postal' },
      { id: `${nested.id}.url`, path: 'Patient.address.extension.url', fixedUri: 'urn:district' },
    ];
    const matches = createSliceDefinitionMatcher(elements);
    const target = { fullPath: 'Patient.address[0].extension[0]' };
    const extension = { url: 'urn:district', valueString: 'Synthetic district' };
    const postal = { resourceType: 'Patient', address: [{ type: 'postal', extension: [extension] }] };
    const physical = { resourceType: 'Patient', address: [{ type: 'physical', extension: [extension] }] };
    expect(matches(extension, nested, { resource: postal, target })).toBe(true);
    expect(matches(extension, nested, { resource: physical, target })).toBe(false);
    expect(matches(extension, nested, { resource: postal, target })).toBe(true);
    expect(matches({ type: 'postal', extension: [{ url: 'urn:unrelated' }] }, parent)).toBe(true);
  });

  it('preserves duplicate ancestor definitions and their order', () => {
    const first: ElementDefinition = { id: 'Patient.identifier:insurance', path: 'Patient.identifier',
      sliceName: 'insurance', patternIdentifier: { system: 'urn:insurance' } };
    const second: ElementDefinition = { ...first, patternIdentifier: { value: 'required' } };
    const child: ElementDefinition = { id: `${first.id}.value`, path: 'Patient.identifier.value' };
    const matches = createSliceDefinitionMatcher([first, second, child]);
    for (const value of ['required', 'different']) {
      const resource = { resourceType: 'Patient', identifier: [{ system: 'urn:insurance', value }] };
      expect(matches(value, child, { resource, target: { fullPath: 'Patient.identifier[0].value' } }))
        .toBe(value === 'required');
    }
  });

  it('agrees with direct matching across a wide profile without retaining resource values', () => {
    const elements: ElementDefinition[] = Array.from({ length: 80 }, (_, index) => [
      { id: `Patient.identifier:kind${index}`, path: 'Patient.identifier', sliceName: `kind${index}` },
      { id: `Patient.identifier:kind${index}.system`, path: 'Patient.identifier.system', fixedUri: `urn:kind:${index}` },
    ]).flat();
    const matches = createSliceDefinitionMatcher(elements);
    for (let index = 0; index < elements.length; index += 2) {
      for (const system of [`urn:kind:${index / 2}`, 'urn:unrelated']) {
        const value = { system, value: 'synthetic' };
        expect(matches(value, elements[index])).toBe(targetMatchesSliceDefinition(value, elements[index], elements));
      }
    }
  });
});
