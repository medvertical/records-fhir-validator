import { describe, expect, it, beforeEach } from 'vitest';
import { CompliesWithValidator } from '../complies-with-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

const COMPLIES_WITH_EXT = {
  url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-compliesWithProfile',
};

function fakeLoader(map: Record<string, StructureDefinition | null>) {
  return {
    loadProfile: async (url: string) => map[url] ?? null,
  } as any;
}

const baseUrl = 'http://example.org/StructureDefinition/base';

function makeBase(diff: any, extras: Partial<StructureDefinition> = {}): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: baseUrl,
    type: 'Patient',
    differential: { element: diff },
    ...extras,
  } as any;
}

function makeDerived(diff: any, extras: Record<string, unknown> = {}) {
  return {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/derived',
    type: 'Patient',
    extension: [{ ...COMPLIES_WITH_EXT, valueCanonical: baseUrl }],
    differential: { element: diff },
    ...extras,
  };
}

function containedValueSet(id: string, codes: string[]) {
  return {
    resourceType: 'ValueSet',
    id,
    url: `http://example.org/ValueSet/${id}`,
    status: 'active',
    compose: {
      include: [{
        system: 'http://example.org/system',
        concept: codes.map(code => ({ code })),
      }],
    },
  };
}

describe('CompliesWithValidator', () => {
  let v: CompliesWithValidator;
  beforeEach(() => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        { id: 'Patient', path: 'Patient' },
        { id: 'Patient.name', path: 'Patient.name', min: 1, max: '*' },
      ]),
    }));
  });

  it('emits no issues when no compliesWithProfile extension is present', async () => {
    const issues = await v.validate({
      resourceType: 'StructureDefinition',
      type: 'Patient',
      differential: { element: [] },
    });
    expect(issues).toHaveLength(0);
  });

  it('flags loosened min cardinality', async () => {
    const issues = await v.validate(makeDerived([
      { id: 'Patient', path: 'Patient' },
      { id: 'Patient.name', path: 'Patient.name', min: 0, max: '*' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(
      "The min value of '0' on the path Patient.name does not comply with the value '1'"
    );
    expect(issues[0].severity).toBe('error');
  });

  it('treats max="0" as effective min=0', async () => {
    const issues = await v.validate(makeDerived([
      { id: 'Patient', path: 'Patient' },
      { id: 'Patient.name', path: 'Patient.name', max: '0' },
    ]));
    expect(issues.some(i => i.message.includes("The min value of '0'"))).toBe(true);
  });

  it('flags widened max cardinality', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        { id: 'Patient.name', path: 'Patient.name', min: 0, max: '2' },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      { id: 'Patient.name', path: 'Patient.name', min: 0, max: '5' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(
      "The max value of '5' on the path Patient.name does not comply with the value '2'"
    );
  });

  it('flags missing constraints carried by the claimed profile', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.name', path: 'Patient.name', min: 1,
          constraint: [{ key: 'pat-1', expression: 'family.exists()' }],
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      { id: 'Patient.name', path: 'Patient.name', min: 1 },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(
      "The constraint 'family.exists()' is defined in the claimed profile, but missing"
    );
  });

  it('flags weakened binding strength', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          binding: { strength: 'required', valueSet: 'http://example.org/vs' },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        binding: { strength: 'extensible', valueSet: 'http://example.org/vs' },
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(
      "The binding.strength value of 'EXTENSIBLE' on the path Patient.maritalStatus does not comply with the value 'REQUIRED'"
    );
  });

  it('does not flag stronger binding strength', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          binding: { strength: 'extensible' },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        binding: { strength: 'required' },
      },
    ]));
    expect(issues).toHaveLength(0);
  });

  it('flags differing required-binding valueSet as cw-binding-superset', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          binding: { strength: 'required', valueSet: 'http://example.org/vs/narrow' },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        binding: { strength: 'required', valueSet: 'http://example.org/vs/broad' },
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(
      "The binding.valueSet value of 'http://example.org/vs/broad' on the path Patient.maritalStatus does not comply with the value 'http://example.org/vs/narrow'",
    );
  });

  it('does not flag a contained derived valueSet that is a subset of the claimed profile valueSet', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.gender', path: 'Patient.gender',
          binding: { strength: 'required', valueSet: '#full' },
        },
      ], {
        contained: [containedValueSet('full', ['male', 'female', 'other', 'unknown'])],
      } as any),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.gender', path: 'Patient.gender',
        binding: { strength: 'required', valueSet: '#subset' },
      },
    ], {
      contained: [containedValueSet('subset', ['male', 'female'])],
    }));
    expect(issues).toHaveLength(0);
  });

  it('flags a contained derived valueSet that includes codes outside the claimed profile valueSet', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.gender', path: 'Patient.gender',
          binding: { strength: 'required', valueSet: '#small' },
        },
      ], {
        contained: [containedValueSet('small', ['male', 'female'])],
      } as any),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.gender', path: 'Patient.gender',
        binding: { strength: 'required', valueSet: '#big' },
      },
    ], {
      contained: [containedValueSet('big', ['male', 'female', 'other', 'unknown'])],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('includes codes not allowed');
    expect(issues[0].message).toContain('other, unknown');
  });

  it('does not flag when the derived valueSet matches the base (same canonical, different version)', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          binding: { strength: 'required', valueSet: 'http://example.org/vs/marital|1.0.0' },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        binding: { strength: 'required', valueSet: 'http://example.org/vs/marital|2.0.0' },
      },
    ]));
    expect(issues).toHaveLength(0);
  });

  it('does not flag valueSet differences for preferred or example bindings', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          binding: { strength: 'preferred', valueSet: 'http://example.org/vs/narrow' },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        binding: { strength: 'preferred', valueSet: 'http://example.org/vs/broad' },
      },
    ]));
    expect(issues).toHaveLength(0);
  });

  it('skips silently when the claimed profile cannot be resolved', async () => {
    v = new CompliesWithValidator(fakeLoader({}));
    const issues = await v.validate(makeDerived([
      { id: 'Patient.name', path: 'Patient.name', min: 0 },
    ]));
    expect(issues).toHaveLength(0);
  });

  it('aggregates multiple reasons into a single issue joined by " and "', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        { id: 'Patient.identifier', path: 'Patient.identifier', min: 1, max: '1' },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      { id: 'Patient.identifier', path: 'Patient.identifier', min: 0, max: '3' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("min value of '0'");
    expect(issues[0].message).toContain("max value of '3'");
    expect(issues[0].message).toContain(' and ');
  });

  it('flags CodeableConcept pattern conflict (system+version mismatch)', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          patternCodeableConcept: {
            coding: [{ system: 'http://hl7.org/cs', version: '5.0.0', code: 'M' }],
          },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        patternCodeableConcept: {
          coding: [{ system: 'http://hl7.org/cs', code: 'M' }],
        },
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('[http://hl7.org/cs#M]');
    expect(issues[0].message).toContain('[http://hl7.org/cs|5.0.0#M]');
  });

  it('flags fixed vs pattern code mismatch', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
          patternCodeableConcept: { coding: [{ system: 'http://x', code: 'M' }] },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.maritalStatus', path: 'Patient.maritalStatus',
        fixedCodeableConcept: { coding: [{ system: 'http://x', code: 'S' }] },
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('[http://x#S]');
    expect(issues[0].message).toContain('[http://x#M]');
  });

  it('flags loosened slice cardinality on a slice id', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.identifier', path: 'Patient.identifier',
          slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' },
        },
        { id: 'Patient.identifier:mrn', path: 'Patient.identifier', sliceName: 'mrn', min: 1, max: '1' },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.identifier', path: 'Patient.identifier',
        slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' },
      },
      { id: 'Patient.identifier:mrn', path: 'Patient.identifier', sliceName: 'mrn', min: 0, max: '3' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Patient.identifier:mrn');
  });

  it('flags slicing rules mismatch (closed -> open)', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.identifier', path: 'Patient.identifier',
          slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'closed' },
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.identifier', path: 'Patient.identifier',
        slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' },
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Mismatch in slicing rules at Patient.identifier: 'open' when the claimed profile has 'closed'");
  });

  it('flags missing required slice with discriminator details', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.identifier', path: 'Patient.identifier',
          slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' },
        },
        {
          id: 'Patient.identifier:mrn', path: 'Patient.identifier',
          sliceName: 'mrn', min: 1, max: '1',
        },
        {
          id: 'Patient.identifier:mrn.system', path: 'Patient.identifier.system',
          patternUri: 'http://hospital/mrn',
        },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.identifier', path: 'Patient.identifier',
        slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' },
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(
      'Mismatch in slicing at Patient.identifier:mrn: no slice found for the discriminator value:system with the values UriType[http://hospital/mrn]'
    );
  });

  it('flags extra slice in a closed-rule parent', async () => {
    v = new CompliesWithValidator(fakeLoader({
      [baseUrl]: makeBase([
        {
          id: 'Patient.identifier', path: 'Patient.identifier',
          slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'closed' },
        },
        { id: 'Patient.identifier:mrn', path: 'Patient.identifier', sliceName: 'mrn', min: 0, max: '1' },
        { id: 'Patient.identifier:mrn.system', path: 'Patient.identifier.system', patternUri: 'http://x/mrn' },
      ]),
    }));
    const issues = await v.validate(makeDerived([
      {
        id: 'Patient.identifier', path: 'Patient.identifier',
        slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'closed' },
      },
      { id: 'Patient.identifier:mrn', path: 'Patient.identifier', sliceName: 'mrn', min: 0, max: '1' },
      { id: 'Patient.identifier:mrn.system', path: 'Patient.identifier.system', patternUri: 'http://x/mrn' },
      { id: 'Patient.identifier:dl', path: 'Patient.identifier', sliceName: 'dl', min: 0, max: '1' },
      { id: 'Patient.identifier:dl.system', path: 'Patient.identifier.system', patternUri: 'http://x/dl' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("extra slice 'dl' not found in the claimed profile");
  });

  it('strips canonical version pin from the claimed url', async () => {
    v = new CompliesWithValidator({
      loadProfile: async (url: string) => {
        // contract: validator must not pass the |version suffix to loader
        if (url.includes('|')) return null;
        return makeBase([
          { id: 'Patient.name', path: 'Patient.name', min: 1 },
        ]);
      },
    } as any);
    const derived = {
      resourceType: 'StructureDefinition',
      type: 'Patient',
      extension: [{ ...COMPLIES_WITH_EXT, valueCanonical: `${baseUrl}|1.0.0` }],
      differential: {
        element: [{ id: 'Patient.name', path: 'Patient.name', min: 0 }],
      },
    };
    const issues = await v.validate(derived);
    expect(issues).toHaveLength(1);
  });
});
