import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../structure-definition-types';
import { selectSliceScopedValues } from '../terminology-binding-selection';
import { TerminologySlicePlanCache } from '../terminology-slice-plan-cache';
import { getValueAtPath } from '../../validation-utils';

// eCR's us-ph-patient expands US Core race and ethnicity inline, each with an
// ombCategory bound to its own value set.
const RACE = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
const ETHNICITY = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
const byUrl = { discriminator: [{ type: 'value' as const, path: 'url' }], rules: 'open' as const };
const extensionSlice = (name: string, url: string) => [
  { id: `Patient.extension:${name}`, path: 'Patient.extension', sliceName: name },
  { id: `Patient.extension:${name}.extension`, path: 'Patient.extension.extension', slicing: byUrl },
  { id: `Patient.extension:${name}.extension:ombCategory`, path: 'Patient.extension.extension', sliceName: 'ombCategory' },
  { id: `Patient.extension:${name}.extension:ombCategory.url`, path: 'Patient.extension.extension.url', fixedUri: 'ombCategory' },
  { id: `Patient.extension:${name}.extension:ombCategory.value[x]`, path: 'Patient.extension.extension.value[x]' },
  {
    id: `Patient.extension:${name}.extension:ombCategory.value[x]:valueCoding`,
    path: 'Patient.extension.extension.value[x]',
    sliceName: 'valueCoding',
    type: [{ code: 'Coding' }],
  },
  { id: `Patient.extension:${name}.extension:text`, path: 'Patient.extension.extension', sliceName: 'text' },
  { id: `Patient.extension:${name}.extension:text.url`, path: 'Patient.extension.extension.url', fixedUri: 'text' },
  { id: `Patient.extension:${name}.url`, path: 'Patient.extension.url', fixedUri: url },
];
const profile = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/us/ecr/StructureDefinition/us-ph-patient',
  type: 'Patient',
  snapshot: {
    element: [
      { id: 'Patient', path: 'Patient' },
      { id: 'Patient.extension', path: 'Patient.extension', slicing: byUrl },
      ...extensionSlice('race', RACE),
      ...extensionSlice('ethnicity', ETHNICITY),
    ],
  },
} as unknown as StructureDefinition;
const white = { system: 'urn:oid:2.16.840.1.113883.6.238', code: '2106-3', display: 'White' };
const notHispanic = { system: 'urn:oid:2.16.840.1.113883.6.238', code: '2186-5' };
const patient = {
  resourceType: 'Patient',
  extension: [
    { url: RACE, extension: [{ url: 'ombCategory', valueCoding: white }, { url: 'text', valueString: 'White' }] },
    { url: ETHNICITY, extension: [{ url: 'ombCategory', valueCoding: notHispanic }] },
  ],
};
const select = (id: string) => selectSliceScopedValues(
  patient, profile.snapshot!.element.find(element => element.id === id)!, profile, getValueAtPath, new TerminologySlicePlanCache(),
);

describe('slices nested in slices', () => {
  it('ranges over the instances inside the enclosing slice only', () => {
    expect(select('Patient.extension:ethnicity.extension:ombCategory.value[x]')).toMatchObject({
      values: [notHispanic],
      paths: ['Patient.extension[1].extension[0].valueCoding'],
    });
  });

  it('takes a type slice on a choice at its JSON key, not the text beside it', () => {
    expect(select('Patient.extension:race.extension:ombCategory.value[x]:valueCoding')).toMatchObject({
      values: [white],
      paths: ['Patient.extension[0].extension[0].valueCoding'],
    });
  });
});
