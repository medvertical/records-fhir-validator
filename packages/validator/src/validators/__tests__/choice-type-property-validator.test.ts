import { describe, it, expect } from 'vitest';
import {
  validateChoiceTypeProperties,
  extractChoiceSlots,
} from '../choice-type-property-validator';

const GROUP_SD = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/Group',
  type: 'Group',
  snapshot: {
    element: [
      {
        path: 'Group.characteristic.value[x]',
        min: 1,
        max: '1',
        type: [
          { code: 'CodeableConcept' },
          { code: 'boolean' },
          { code: 'Quantity' },
          { code: 'Range' },
          { code: 'Reference' },
        ],
      },
    ],
  },
} as any;

describe('extractChoiceSlots', () => {
  it('finds all `X[x]` elements and their allowed type suffixes', () => {
    const slots = extractChoiceSlots(GROUP_SD);
    expect(slots).toHaveLength(1);
    expect(slots[0].baseName).toBe('value');
    expect(slots[0].parentPath).toBe('Group.characteristic');
    expect(slots[0].allowedSuffixes).toEqual([
      'CodeableConcept', 'Boolean', 'Quantity', 'Range', 'Reference',
    ]);
    expect(slots[0].min).toBe(1);
  });

  it('ignores elements without `[x]` suffix', () => {
    const sd = {
      snapshot: { element: [{ path: 'Group.code', type: [{ code: 'CodeableConcept' }] }] },
    } as any;
    expect(extractChoiceSlots(sd)).toHaveLength(0);
  });

  it('ignores elements with empty type list', () => {
    const sd = {
      snapshot: { element: [{ path: 'Group.value[x]', type: [] }] },
    } as any;
    expect(extractChoiceSlots(sd)).toHaveLength(0);
  });
});

describe('validateChoiceTypeProperties', () => {
  it('flags unsuffixed "value" usage where SD declares "value[x]"', () => {
    const resource = {
      resourceType: 'Group',
      type: 'person',
      membership: 'definitional',
      characteristic: [
        { code: { text: 'test' }, value: true, exclude: false },
      ],
    };
    const issues = validateChoiceTypeProperties(resource, GROUP_SD);
    const unknown = issues.find(i => i.code === 'structural-unknown-element');
    expect(unknown).toBeDefined();
    expect(unknown?.path).toBe('Group.characteristic[0].value');
    const cardMin = issues.find(i => i.code === 'structural-cardinality-min');
    expect(cardMin).toBeDefined();
  });

  it('does NOT flag wrong-suffix cases (valueInteger) — handled by type-mismatch', () => {
    // Scoping decision: the existing `structural-type-mismatch` already
    // flags wrong-type suffix cases. Firing this validator too would
    // regress profile-restricted tests where a valid FHIR suffix is
    // disallowed only by the profile.
    const resource = {
      resourceType: 'Group',
      type: 'person',
      membership: 'definitional',
      characteristic: [
        { code: { text: 'test' }, valueInteger: 1, exclude: false },
      ],
    };
    const issues = validateChoiceTypeProperties(resource, GROUP_SD);
    expect(
      issues.filter(i => i.code === 'structural-unknown-element'),
    ).toHaveLength(0);
  });

  it('accepts any valid-suffix form (valueBoolean / valueQuantity)', () => {
    const ok = {
      resourceType: 'Group',
      type: 'person',
      membership: 'definitional',
      characteristic: [
        { code: { text: 'test' }, valueBoolean: true, exclude: false },
      ],
    };
    const issues = validateChoiceTypeProperties(ok, GROUP_SD);
    expect(
      issues.filter(i => i.code === 'structural-unknown-element'),
    ).toHaveLength(0);
  });

  it('does not error on structurally valid resources without the slot at all', () => {
    const ok = {
      resourceType: 'Group',
      type: 'person',
      membership: 'definitional',
      characteristic: [{ code: { text: 'test' }, exclude: false }],
    };
    const issues = validateChoiceTypeProperties(ok, GROUP_SD);
    // No value[x] variant present — the cardinality-min check is not
    // this validator's job when the user didn't even try to set one;
    // that's left to the existing cardinality validator.
    expect(issues.filter(i => i.code === 'structural-unknown-element')).toHaveLength(0);
  });

  it('handles resources with no SD gracefully', () => {
    const r = { resourceType: 'Group', characteristic: [{ value: true }] };
    expect(validateChoiceTypeProperties(r, undefined)).toEqual([]);
  });
});
