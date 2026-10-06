import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types';
import { TerminologySlicePlanCache } from '../terminology-slice-plan-cache';

describe('TerminologySlicePlanCache', () => {
  it('invalidates cached plans when snapshot elements are added in place', () => {
    const slice: ElementDefinition = {
      id: 'Observation.category:first',
      path: 'Observation.category',
      sliceName: 'first',
    };
    const elements = [slice];
    const structureDef = {
      resourceType: 'StructureDefinition',
      snapshot: { element: elements },
    } as StructureDefinition;
    const cache = new TerminologySlicePlanCache();

    expect(cache.getSiblingSlicePatterns(structureDef, slice)).toEqual([]);
    elements.push({
      id: 'Observation.category:second',
      path: 'Observation.category',
      sliceName: 'second',
      patternCodeableConcept: { text: 'second' },
    } as ElementDefinition);

    expect(cache.getSiblingSlicePatterns(structureDef, slice)).toHaveLength(1);
  });

  it('does not sort by value set the slices that fix the discriminator value', () => {
    const base = 'Observation.code.coding';
    const slice = (name: string, system: string, valueSet: string): ElementDefinition[] => [
      { id: `${base}:${name}`, path: base, sliceName: name, binding: { strength: 'required', valueSet } },
      { id: `${base}:${name}.system`, path: `${base}.system`, fixedUri: system } as ElementDefinition,
    ];
    const [loinc, ...loincChildren] = slice('loinc', 'http://loinc.org', 'https://example.test/ValueSet/loinc-tests');
    const structureDef = {
      resourceType: 'StructureDefinition',
      snapshot: { element: [
        { id: base, path: base, slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'closed' } },
        loinc, ...loincChildren,
        ...slice('snomedCT', 'http://snomed.info/sct', 'https://example.test/ValueSet/snomed-tests'),
      ] },
    } as StructureDefinition;

    expect(new TerminologySlicePlanCache().isValueSetDiscriminatedSliceRoot(loinc, structureDef)).toBe(false);
  });

  it('sorts by value set the slices told apart by their bindings alone', () => {
    const base = 'Condition.category';
    const usCore: ElementDefinition = { id: `${base}:us-core`, path: base, sliceName: 'us-core',
      binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern' } };
    const structureDef = {
      resourceType: 'StructureDefinition',
      snapshot: { element: [
        { id: base, path: base, slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
        usCore,
        { id: `${base}:screening-assessment`, path: base, sliceName: 'screening-assessment',
          binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-screening-assessment-condition-category' } },
      ] },
    } as StructureDefinition;

    expect(new TerminologySlicePlanCache().isValueSetDiscriminatedSliceRoot(usCore, structureDef)).toBe(true);
  });
});

