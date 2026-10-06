import { describe, expect, it } from 'vitest';
import { matchDiscriminator } from '../slice-discriminator-matcher';
import {
  codingMatchesBindingCodes,
  getValueAtPath,
  matchesPattern,
  splitCanonicalReference,
  valuesMatch,
} from '../slice-utils';
import type { SliceDefinition } from '../slice-types';

describe('getValueAtPath', () => {
  it('continues resolving after array and choice-type segments', () => {
    const extension = {
      extension: [
        {
          url: 'fieldStrength',
          valueQuantity: {
            value: 3,
            unit: 'tesla',
            system: 'http://unitsofmeasure.org',
            code: 'T',
          },
        },
      ],
    };

    expect(getValueAtPath(extension, 'extension.value[x].unit')).toBe('tesla');
    expect(getValueAtPath(extension, 'extension.value[x].system')).toBe('http://unitsofmeasure.org');
    expect(getValueAtPath(extension, 'extension.value[x].code')).toBe('T');
  });

  it('uses the first array element that resolves the complete path', () => {
    const extension = {
      extension: [
        {
          url: 'withoutSystem',
          valueQuantity: {
            value: 3,
            unit: 'tesla',
          },
        },
        {
          url: 'withSystem',
          valueQuantity: {
            value: 5,
            system: 'http://unitsofmeasure.org',
          },
        },
      ],
    };

    expect(getValueAtPath(extension, 'extension.value[x].system')).toBe('http://unitsofmeasure.org');
  });

  it('returns all values when several array entries resolve the complete path', () => {
    expect(getValueAtPath({
      extension: [
        { valueString: 'first' },
        { valueString: 'second' },
      ],
    }, 'extension.value[x]')).toEqual(['first', 'second']);
  });

  it('terminates cyclic arrays while retaining later resolvable values', () => {
    const extensions: unknown[] = [];
    extensions.push(extensions, { valueString: 'resolved' });

    expect(getValueAtPath({ extension: extensions }, 'extension.value[x]')).toBe('resolved');
  });
});

describe('slice value utilities', () => {
  it('compares cyclic values without recursion failure', () => {
    const first: Record<string, unknown> = {};
    first.self = first;
    const second: Record<string, unknown> = {};
    second.self = second;

    expect(valuesMatch(first, second)).toBe(true);
    second.extra = true;
    expect(valuesMatch(first, second)).toBe(false);
  });

  it('matches cyclic patterns without recursion failure', () => {
    const pattern: Record<string, unknown> = {};
    pattern.self = pattern;
    const actual: Record<string, unknown> = {};
    actual.self = actual;

    expect(matchesPattern(actual, pattern)).toBe(true);
  });

  it('rejects malformed canonical version separators', () => {
    expect(splitCanonicalReference('http://example.org/StructureDefinition/x|')).toBeNull();
    expect(splitCanonicalReference('http://example.org/StructureDefinition/x|1|extra')).toBeNull();
  });

  it('continues through malformed cyclic coding members', () => {
    const codings: unknown[] = [];
    codings.push(codings, { system: 'http://loinc.org', code: '1234-5' });

    expect(codingMatchesBindingCodes(
      { coding: codings },
      new Set(['http://loinc.org|1234-5']),
    )).toBe(true);
  });

  it('matches a bare Coding array as resolved by repeating discriminator paths', () => {
    expect(codingMatchesBindingCodes(
      [{ system: 'urn:iso:std:iso:11073:10101', code: '528457' }],
      new Set(['urn:iso:std:iso:11073:10101|528457', '528457']),
    )).toBe(true);
    expect(codingMatchesBindingCodes(
      [{ system: 'urn:iso:std:iso:11073:10101', code: '999999' }],
      new Set(['urn:iso:std:iso:11073:10101|528457', '528457']),
    )).toBe(false);
  });

  it('terminates cyclic bare arrays without matching', () => {
    const codings: unknown[] = [];
    codings.push(codings);

    expect(codingMatchesBindingCodes(codings, new Set(['528457']))).toBe(false);
  });
});

describe('matchDiscriminator', () => {
  it('matches value discriminators via child binding codes when the path ends at a repeating coding', () => {
    // PHD PhgDevice/PhdDevice: Device.specialization slice MDCType discriminates
    // on `systemType.coding` through a required binding, not fixed/pattern.
    const element = {
      systemType: {
        coding: [{ system: 'urn:iso:std:iso:11073:10101', code: '528457' }],
        text: 'Generic 11073 device',
      },
      version: '2',
    };
    const slice: SliceDefinition = {
      sliceName: 'MDCType',
      path: 'Device.specialization',
      min: 1,
      max: '*',
      discriminator: [{ type: 'value', path: 'systemType.coding' }],
      childBindingValueSets: new Map([
        ['systemType.coding', 'http://hl7.org/fhir/uv/phd/ValueSet/DeviceTypes11073MDC'],
      ]),
      childBindingCodes: new Map([
        ['systemType.coding', new Set(['urn:iso:std:iso:11073:10101|528457', '528457'])],
      ]),
    };

    expect(matchDiscriminator(
      element,
      slice,
      { type: 'value', path: 'systemType.coding' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);

    expect(matchDiscriminator(
      { systemType: { coding: [{ system: 'urn:iso:std:iso:11073:10101', code: '999999' }] } },
      slice,
      { type: 'value', path: 'systemType.coding' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('lets a required binding decide a $this pattern slice whatever its optional sub-extensions fix', () => {
    // gematik Directory slices HealthcareService.characteristic by pattern on
    // $this; physicalFeatures binds a value set and allows an optional note
    // extension, whose fixed url holds only where the note is present.
    const physicalFeatures: SliceDefinition = {
      sliceName: 'physicalFeatures',
      path: 'HealthcareService.characteristic',
      min: 0,
      max: '*',
      bindingValueSet: 'https://gematik.de/fhir/directory/ValueSet/PhysicalFeaturesHealthCareServiceVS',
      bindingCodes: new Set(['https://gematik.de/fhir/directory/CodeSystem/physicalFeatures|oepnv', 'oepnv']),
      childFixed: new Map([
        ['extension:additionalNote.url', 'https://gematik.de/fhir/directory/StructureDefinition/PhysicalFeaturesAdditionalNoteEX'],
      ]),
    };
    const withoutNote = { coding: [{ system: 'https://gematik.de/fhir/directory/CodeSystem/physicalFeatures', code: 'oepnv' }] };

    expect(matchDiscriminator(
      withoutNote, physicalFeatures, { type: 'pattern', path: '$this' }, null, matchesPattern, codingMatchesBindingCodes,
    )).toBe(true);
  });

  it('lets a fixed value pick out a pattern-discriminated slice as a pattern would', () => {
    // Dental Data Exchange fixes the dental category on a slice of a slicing
    // discriminated by pattern on $this; the problem-list category is not in it.
    const dental: SliceDefinition = {
      sliceName: 'dental', path: 'Condition.category', min: 1, max: '1',
      fixed: { coding: [{ system: 'http://hl7.org/fhir/us/dental-data-exchange/CodeSystem/dental-category', code: 'dental', display: 'Dental' }] },
    };
    const byPattern = { type: 'pattern' as const, path: '$this' };
    const problem = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }], text: 'Problem' };
    const category = { coding: [{ system: 'http://hl7.org/fhir/us/dental-data-exchange/CodeSystem/dental-category', code: 'dental', display: 'Dental' }] };

    expect(matchDiscriminator(problem, dental, byPattern, null, matchesPattern, codingMatchesBindingCodes)).toBe(false);
    expect(matchDiscriminator(category, dental, byPattern, null, matchesPattern, codingMatchesBindingCodes)).toBe(true);
  });

  it('types a Quantity-shaped choice value as the Quantity specialization a slice names', () => {
    // MedMorph type-slices relatedAction.offset[x]; offsetDuration carries no type marker.
    const offsetDuration: SliceDefinition = {
      sliceName: 'offsetDuration', path: 'PlanDefinition.action.relatedAction.offset[x]', min: 0, max: '1', type: [{ code: 'Duration' }],
    };
    const duration = { value: 60, system: 'http://unitsofmeasure.org', code: 's' };

    expect(matchDiscriminator(duration, offsetDuration, { type: 'type', path: '$this' }, null, matchesPattern, codingMatchesBindingCodes)).toBe(true);
  });

  it('tests a pathed type discriminator against the type of the child it names', () => {
    // Radiation Dose Summary slices Observation.performer by type at `reference`,
    // which the reference validator reads as `reference is string`.
    const person: SliceDefinition = {
      sliceName: 'irradiationAuthorizingPerson', path: 'Observation.performer', min: 1, max: '1',
      type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Practitioner'] }],
    };

    expect(matchDiscriminator({ reference: 'Practitioner/33' }, person, { type: 'type', path: 'reference' }, null, matchesPattern, codingMatchesBindingCodes, [person])).toBe(true);
  });

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

  it('applies value discriminators to the resolved root instead of treating them as profiles', () => {
    const resolved = { resourceType: 'Observation', status: 'final' };
    const slice: SliceDefinition = {
      sliceName: 'final-observation',
      path: 'DiagnosticReport.result',
      min: 0,
      max: '*',
      discriminator: [{ type: 'value', path: 'resolve()' }],
      fixed: resolved,
    };

    expect(matchDiscriminator(
      { reference: 'Observation/obs-1' },
      slice,
      { type: 'value', path: 'resolve()' },
      () => resolved,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);
  });

  it('applies pattern discriminators to the resolved root', () => {
    const slice: SliceDefinition = {
      sliceName: 'final-observation',
      path: 'DiagnosticReport.result',
      min: 0,
      max: '*',
      discriminator: [{ type: 'pattern', path: 'resolve()' }],
      pattern: { status: 'final' },
    };

    expect(matchDiscriminator(
      { reference: 'Observation/obs-1' },
      slice,
      { type: 'pattern', path: 'resolve()' },
      () => ({ resourceType: 'Observation', status: 'final', id: 'obs-1' }),
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);
  });

  it('treats empty arrays as absent for exists discriminators', () => {
    const slice: SliceDefinition = {
      sliceName: 'without-category',
      path: 'Observation.category',
      min: 0,
      max: '*',
      discriminator: [{ type: 'exists', path: '$this' }],
    };

    expect(matchDiscriminator(
      [],
      slice,
      { type: 'exists', path: '$this' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('rejects malformed resolved values without throwing', () => {
    const slice: SliceDefinition = {
      sliceName: 'observation',
      path: 'DiagnosticReport.result',
      min: 0,
      max: '*',
      discriminator: [{ type: 'profile', path: 'resolve()' }],
      type: [{ code: 'Reference', targetProfile: ['https://example.org/Observation'] }],
    };

    expect(matchDiscriminator(
      { reference: 'Observation/obs-1' },
      slice,
      { type: 'profile', path: 'resolve()' },
      () => 42,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('matches $this.resolve() profile discriminators against resolved targetProfile references', () => {
    const targetProfile = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/StructureDefinition/mii-pr-onko-diagnose-primaertumor';
    const slice: SliceDefinition = {
      sliceName: 'Primaertumor',
      path: 'MedicationRequest.reasonReference',
      min: 1,
      max: '1',
      discriminator: [{ type: 'profile', path: '$this.resolve()' }],
      type: [{ code: 'Reference', targetProfile: [targetProfile] }],
    };

    expect(matchDiscriminator(
      { reference: 'Condition/mii-exa-onko-colorectal-cancer-diagnosis' },
      slice,
      { type: 'profile', path: '$this.resolve()' },
      () => ({
        resourceType: 'Condition',
        id: 'mii-exa-onko-colorectal-cancer-diagnosis',
        meta: { profile: [`${targetProfile}|2026.0.3`] },
      }),
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

  it('does not treat a target profile claim as resolve().code value evidence', () => {
    const targetProfile = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-diagnostic-conclusion-grouper';
    const slice: SliceDefinition = {
      sliceName: 'diagnostic-conclusion',
      path: 'DiagnosticReport.result',
      min: 1,
      max: '1',
      discriminator: [{ type: 'value', path: 'resolve().code' }],
      type: [{ code: 'Reference', targetProfile: [targetProfile] }],
    };

    expect(matchDiscriminator(
      { reference: 'Observation/mii-exa-patho-diagnostic-conclusion-grouper' },
      slice,
      { type: 'value', path: 'resolve().code' },
      () => ({
        resourceType: 'Observation',
        id: 'mii-exa-patho-diagnostic-conclusion-grouper',
        meta: { profile: [`${targetProfile}|2026.0.0`] },
        code: { coding: [{ system: 'http://loinc.org', code: '22637-3' }] },
      }),
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('does not match resolve() value discriminators by targetProfile when the resolved resource declares another profile', () => {
    const targetProfile = 'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-diagnostic-conclusion-grouper';
    const slice: SliceDefinition = {
      sliceName: 'diagnostic-conclusion',
      path: 'DiagnosticReport.result',
      min: 1,
      max: '1',
      discriminator: [{ type: 'value', path: 'resolve().code' }],
      type: [{ code: 'Reference', targetProfile: [targetProfile] }],
    };

    expect(matchDiscriminator(
      { reference: 'Observation/other' },
      slice,
      { type: 'value', path: 'resolve().code' },
      () => ({
        resourceType: 'Observation',
        id: 'other',
        meta: { profile: ['https://example.org/fhir/StructureDefinition/other'] },
        code: { coding: [{ system: 'http://loinc.org', code: '22637-3' }] },
      }),
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('matches profile $this discriminators on datatypes via merged type-profile patterns', () => {
    // SDC sdc-questionnaire-modular-library: useContext sliced by profile on
    // $this against a UsageContext datatype profile. Datatypes carry no
    // meta.profile, so membership comes from the profile's pattern
    // constraints merged into the slice's child maps.
    const slice: SliceDefinition = {
      sliceName: 'library',
      path: 'Questionnaire.useContext',
      min: 1,
      max: '1',
      discriminator: [{ type: 'profile', path: '$this' }],
      type: [{
        code: 'UsageContext',
        profile: ['http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-usagecontext-questionnaire-library'],
      }],
      childPatterns: new Map<string, unknown>([
        ['code', { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'workflow' }],
        ['value[x]:valueCodeableConcept', {
          coding: [{ system: 'http://hl7.org/fhir/uv/sdc/CodeSystem/temp', code: 'question-library' }],
        }],
      ]),
    };
    const discriminator = { type: 'profile', path: '$this' } as const;

    expect(matchDiscriminator(
      {
        code: { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'workflow' },
        valueCodeableConcept: {
          coding: [{ system: 'http://hl7.org/fhir/uv/sdc/CodeSystem/temp', code: 'question-library' }],
        },
      },
      slice,
      discriminator,
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(true);

    expect(matchDiscriminator(
      {
        code: { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'task' },
        valueCodeableConcept: {
          coding: [{ system: 'http://hl7.org/fhir/uv/sdc/CodeSystem/temp', code: 'other' }],
        },
      },
      slice,
      discriminator,
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });

  it('matches value discriminators crossing a resliced repeat via the sub-slice union', () => {
    // AU Core blood pressure: Observation.component sliced on code.coding.code
    // + code.coding.system while SystolicBP reslices code.coding (LOINC 8480-6
    // and SNOMED 271649006, one fixed pair per sub-slice).
    const slice: SliceDefinition = {
      sliceName: 'SystolicBP',
      path: 'Observation.component',
      min: 1,
      max: '1',
      discriminator: [
        { type: 'value', path: 'code.coding.code' },
        { type: 'value', path: 'code.coding.system' },
      ],
      childFixed: new Map<string, unknown>([
        ['code.coding:SBPCode.system', 'http://loinc.org'],
        ['code.coding:SBPCode.code', '8480-6'],
        ['code.coding:snomedSBP.system', 'http://snomed.info/sct'],
        ['code.coding:snomedSBP.code', '271649006'],
      ]),
    };
    const systolic = {
      code: {
        coding: [
          { system: 'http://loinc.org', code: '8480-6' },
          { system: 'http://snomed.info/sct', code: '271649006' },
        ],
      },
    };
    const diastolic = {
      code: {
        coding: [
          { system: 'http://loinc.org', code: '8462-4' },
          { system: 'http://snomed.info/sct', code: '271650006' },
        ],
      },
    };

    for (const discriminator of slice.discriminator!) {
      expect(matchDiscriminator(
        systolic, slice, discriminator, null, matchesPattern, codingMatchesBindingCodes,
      )).toBe(true);
    }
    expect(matchDiscriminator(
      diastolic,
      slice,
      { type: 'value', path: 'code.coding.code' },
      null,
      matchesPattern,
      codingMatchesBindingCodes,
    )).toBe(false);
  });
});
