import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';
import { focusResourceOf } from '../sd-fhirpath-focus-resource';

// KBV's Impfpass bundles a Patient whose gender carries de.basisprofil's
// gender-amtlich-de; its invariant reads %resource.gender, which is the
// Patient's, not the Bundle's.
const patient = {
  resourceType: 'Patient',
  gender: 'other',
  _gender: { extension: [{ url: 'http://fhir.de/StructureDefinition/gender-amtlich-de', valueCoding: { code: 'X' } }] },
};
const bundle = { resourceType: 'Bundle', type: 'document', entry: [{ resource: { resourceType: 'Composition' } }, { resource: patient }] };
const genderAmtlich = {
  resourceType: 'StructureDefinition',
  url: 'http://fhir.de/StructureDefinition/gender-amtlich-de',
  type: 'Extension',
  snapshot: {
    element: [
      { id: 'Extension', path: 'Extension' },
      {
        id: 'Extension.value[x]',
        path: 'Extension.value[x]',
        type: [{ code: 'Coding' }],
        constraint: [{
          key: 'gender-amtlich-1',
          severity: 'error',
          human: "Die amtliche Differenzierung der Geschlechtsangabe 'other' darf nur gefüllt sein, wenn das Geschlecht 'other' angegeben ist",
          expression: "%resource.where(gender='other').exists()",
        }],
      },
    ],
  },
} as unknown as StructureDefinition;

describe('%resource in profile invariants', () => {
  it('finds the resource that contains a node inside a Bundle', () => {
    expect(focusResourceOf(bundle, 'Bundle.entry[1].resource.gender')).toBe(patient);
    expect(focusResourceOf(bundle, 'Bundle.type')).toBe(bundle);
  });

  it('evaluates an extension invariant against the resource carrying the extension', async () => {
    const executor = new SDFHIRPathExecutor();
    const extension = { resourceType: 'Extension', ...patient._gender.extension[0] };
    const context = { resource: extension, rootResource: bundle, resourceType: 'Extension', structureDef: genderAmtlich };

    await expect(executor.execute({ ...context, focusResource: patient })).resolves.toEqual([]);
    await expect(executor.execute(context)).resolves.toHaveLength(1);
  });
});
