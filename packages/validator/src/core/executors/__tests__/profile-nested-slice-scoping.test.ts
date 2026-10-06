import { describe, expect, it } from 'vitest';
import { getValueAtPath } from '../../validation-utils';
import type { StructureDefinition } from '../../structure-definition-types';
import { resolveNestedSliceParentItems } from '../profile-nested-slice-scoping';

describe('nested slice scoping', () => {
  it('uses all parent discriminators when fixed values live below a child slice label', () => {
    const systolic = { code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] } };
    const diastolic = { code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] } };
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/bp-test',
      name: 'BloodPressureTest',
      type: 'Observation',
      status: 'active',
      kind: 'resource',
      abstract: false,
      snapshot: {
        element: [
          {
            id: 'Observation.component',
            path: 'Observation.component',
            slicing: {
              discriminator: [
                { type: 'value', path: 'code.coding.code' },
                { type: 'value', path: 'code.coding.system' },
              ],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:SystolicBP',
            path: 'Observation.component',
            sliceName: 'SystolicBP',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding',
            path: 'Observation.component.code.coding',
            slicing: {
              discriminator: [{ type: 'value', path: 'code' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SBPCode.code',
            path: 'Observation.component.code.coding.code',
            fixedCode: '8480-6',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SBPCode.system',
            path: 'Observation.component.code.coding.system',
            fixedUri: 'http://loinc.org',
          },
        ],
      },
    };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'Observation', component: [systolic, diastolic] },
      profile.snapshot!.element[2],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([systolic.code]);
  });

  it('unions discriminator constraints when the parent slice reslices the repeat', () => {
    // AU Core blood pressure: SystolicBP fixes code.coding.code once per
    // sub-slice (LOINC 8480-6 + SNOMED 271649006); any of them identifies
    // membership — conflicting values must not disable scoping.
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
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/bp-union-test',
      name: 'BloodPressureUnionTest',
      type: 'Observation',
      status: 'active',
      kind: 'resource',
      abstract: false,
      snapshot: {
        element: [
          {
            id: 'Observation.component',
            path: 'Observation.component',
            slicing: {
              discriminator: [
                { type: 'value', path: 'code.coding.code' },
                { type: 'value', path: 'code.coding.system' },
              ],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:SystolicBP',
            path: 'Observation.component',
            sliceName: 'SystolicBP',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding',
            path: 'Observation.component.code.coding',
            slicing: {
              discriminator: [{ type: 'value', path: 'code' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SBPCode.code',
            path: 'Observation.component.code.coding.code',
            fixedCode: '8480-6',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SBPCode.system',
            path: 'Observation.component.code.coding.system',
            fixedUri: 'http://loinc.org',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:snomedSBP.code',
            path: 'Observation.component.code.coding.code',
            fixedCode: '271649006',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:snomedSBP.system',
            path: 'Observation.component.code.coding.system',
            fixedUri: 'http://snomed.info/sct',
          },
        ],
      },
    };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'Observation', component: [systolic, diastolic] },
      profile.snapshot!.element[2],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([systolic.code]);
  });

  it('matches discriminator values found after an earlier array entry', () => {
    const matchingCode = {
      coding: [
        { system: 'http://snomed.info/sct', code: 'wrong' },
        { system: 'http://loinc.org', code: '8480-6' },
      ],
    };
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/bp-array-test',
      name: 'BloodPressureArrayTest',
      type: 'Observation',
      status: 'active',
      kind: 'resource',
      abstract: false,
      snapshot: {
        element: [
          {
            id: 'Observation.component',
            path: 'Observation.component',
            slicing: {
              discriminator: [
                { type: 'value', path: 'code.coding.code' },
                { type: 'value', path: 'code.coding.system' },
              ],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:SystolicBP',
            path: 'Observation.component',
            sliceName: 'SystolicBP',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding',
            path: 'Observation.component.code.coding',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SBPCode.code',
            path: 'Observation.component.code.coding.code',
            fixedCode: '8480-6',
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SBPCode.system',
            path: 'Observation.component.code.coding.system',
            fixedUri: 'http://loinc.org',
          },
        ],
      },
    };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'Observation', component: [{ code: matchingCode }] },
      profile.snapshot!.element[2],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([matchingCode]);
  });

  it('scopes by declared slice type when the parent slicing discriminates by type on $this', () => {
    // Mirrors PHD PhdCompoundObservation: coding is sliced (MdcType, min 1)
    // inside value[x]:valueCodeableConcept; sibling Quantity/string values
    // must stay out of scope or the coding minimum misfires on them.
    const codeableValue = { coding: [{ system: 'urn:iso:std:iso:11073:10101', code: '8417872' }] };
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/compound-test',
      name: 'CompoundTest',
      type: 'Observation',
      status: 'active',
      kind: 'resource',
      abstract: false,
      snapshot: {
        element: [
          {
            id: 'Observation.component',
            path: 'Observation.component',
          },
          {
            id: 'Observation.component:measurement',
            path: 'Observation.component',
            sliceName: 'measurement',
          },
          {
            id: 'Observation.component:measurement.value[x]',
            path: 'Observation.component.value[x]',
            slicing: {
              discriminator: [{ type: 'type', path: '$this' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:measurement.value[x]:valueCodeableConcept',
            path: 'Observation.component.value[x]',
            sliceName: 'valueCodeableConcept',
            type: [{ code: 'CodeableConcept' }],
          },
          {
            id: 'Observation.component:measurement.value[x]:valueCodeableConcept.coding',
            path: 'Observation.component.value[x].coding',
            slicing: {
              discriminator: [{ type: 'value', path: 'system' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.component:measurement.value[x]:valueCodeableConcept.coding:MdcType',
            path: 'Observation.component.value[x].coding',
            sliceName: 'MdcType',
            min: 1,
          },
          {
            id: 'Observation.component:measurement.value[x]:valueCodeableConcept.coding:MdcType.system',
            path: 'Observation.component.value[x].coding.system',
            fixedUri: 'urn:iso:std:iso:11073:10101',
          },
        ],
      },
    };

    const scoped = resolveNestedSliceParentItems(
      {
        resourceType: 'Observation',
        component: [
          { valueQuantity: { value: 6.3, unit: 'mmol/l', system: 'http://unitsofmeasure.org', code: 'mmol/L' } },
          { valueCodeableConcept: codeableValue },
          { valueString: 'Somewhere on the body.' },
        ],
      },
      profile.snapshot!.element[4],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([codeableValue]);
  });

  it('scopes by an extension() function discriminator instead of leaking sibling-slice fixed values', () => {
    const scopeUrl = 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-careTeamClaimScope';
    const overallMember = { extension: [{ url: scopeUrl, valueBoolean: true }], sequence: 1 };
    const itemMember = { extension: [{ url: scopeUrl, valueBoolean: false }], sequence: 2 };
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim',
      name: 'PASClaim',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Claim',
      snapshot: {
        element: [
          {
            id: 'Claim.careTeam',
            path: 'Claim.careTeam',
            slicing: {
              discriminator: [{ type: 'value', path: `extension('${scopeUrl}').value.ofType(boolean)` }],
              rules: 'open',
            },
          },
          {
            id: 'Claim.careTeam:ItemClaimMember',
            path: 'Claim.careTeam',
            sliceName: 'ItemClaimMember',
          },
          {
            id: 'Claim.careTeam:ItemClaimMember.extension',
            path: 'Claim.careTeam.extension',
            slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' },
          },
          {
            id: 'Claim.careTeam:ItemClaimMember.extension:careTeamClaimScope',
            path: 'Claim.careTeam.extension',
            sliceName: 'careTeamClaimScope',
            type: [{ code: 'Extension', profile: [scopeUrl] }],
          },
          {
            id: 'Claim.careTeam:ItemClaimMember.extension:careTeamClaimScope.value[x]',
            path: 'Claim.careTeam.extension.value[x]',
            fixedBoolean: false,
          },
        ],
      },
    };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'Claim', careTeam: [overallMember, itemMember] },
      profile.snapshot!.element[2],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([itemMember]);
  });

  it('scopes through a pathed type discriminator on the parent slice', () => {
    // PDQm MatchParametersOut slices Bundle.entry by resource TYPE
    // (discriminator type=type, path=resource); the patient slice's
    // search.extension slicing must only see Patient entries, or the
    // MatchGrade minimum misfires on the OperationOutcome entry.
    const patientEntry = {
      resource: { resourceType: 'Patient', id: 'p1' },
      search: { mode: 'match', score: 0.9, extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/match-grade', valueCode: 'probable' }] },
    };
    const outcomeEntry = {
      resource: { resourceType: 'OperationOutcome', id: 'o1' },
      search: { mode: 'outcome' },
    };
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'https://profiles.ihe.net/ITI/PDQm/StructureDefinition/IHE.PDQm.MatchParametersOut',
      name: 'MatchParametersOutTest',
      type: 'Bundle',
      status: 'active',
      kind: 'resource',
      abstract: false,
      snapshot: {
        element: [
          {
            id: 'Bundle.entry',
            path: 'Bundle.entry',
            slicing: { discriminator: [{ type: 'type', path: 'resource' }], rules: 'open' },
          },
          {
            id: 'Bundle.entry:patient',
            path: 'Bundle.entry',
            sliceName: 'patient',
          },
          {
            id: 'Bundle.entry:patient.resource',
            path: 'Bundle.entry.resource',
            type: [{ code: 'Patient' }],
          },
          {
            id: 'Bundle.entry:patient.search.extension',
            path: 'Bundle.entry.search.extension',
            slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' },
          },
          {
            id: 'Bundle.entry:patient.search.extension:MatchGrade',
            path: 'Bundle.entry.search.extension',
            sliceName: 'MatchGrade',
            min: 1,
            max: '1',
            type: [{ code: 'Extension', profile: ['http://hl7.org/fhir/StructureDefinition/match-grade'] }],
          },
        ],
      },
    };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'Bundle', type: 'searchset', entry: [patientEntry, outcomeEntry] },
      profile.snapshot!.element[3],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([patientEntry.search]);
  });

  const OTHER_ID_URL = 'https://profiles.ihe.net/ITI/BALP/StructureDefinition/ihe-otherId';

  function buildResliceValueProfile(npiUrl: string = OTHER_ID_URL): StructureDefinition {
    return {
      resourceType: 'StructureDefinition',
      url: 'https://profiles.ihe.net/ITI/BALP/StructureDefinition/IHE.BasicAudit.SAMLaccessTokenUse.Comprehensive',
      name: 'SamlResliceValueTest',
      type: 'AuditEvent',
      status: 'active',
      kind: 'resource',
      abstract: false,
      snapshot: {
        element: [
          {
            id: 'AuditEvent.agent:user.extension',
            path: 'AuditEvent.agent.extension',
            slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' },
          },
          {
            id: 'AuditEvent.agent:user.extension:otherId/subject-id',
            path: 'AuditEvent.agent.extension',
            sliceName: 'otherId/subject-id',
            type: [{ code: 'Extension', profile: [OTHER_ID_URL] }],
          },
          {
            id: 'AuditEvent.agent:user.extension:otherId/subject-id.url',
            path: 'AuditEvent.agent.extension.url',
            fixedUri: OTHER_ID_URL,
          },
          {
            id: 'AuditEvent.agent:user.extension:otherId/subject-id.value[x]',
            path: 'AuditEvent.agent.extension.value[x]',
            slicing: { discriminator: [{ type: 'type', path: '$this' }], rules: 'closed' },
          },
          {
            id: 'AuditEvent.agent:user.extension:otherId/npi',
            path: 'AuditEvent.agent.extension',
            sliceName: 'otherId/npi',
            type: [{ code: 'Extension', profile: [npiUrl] }],
          },
          {
            id: 'AuditEvent.agent:user.extension:otherId/npi.url',
            path: 'AuditEvent.agent.extension.url',
            fixedUri: npiUrl,
          },
        ],
      },
    };
  }

  it('excludes items that also satisfy a sibling reslice with identical discriminator evidence', () => {
    // BALP reslices all fix the same extension url, so no item can be
    // attributed to one of them — validating nested content anyway invents
    // pattern mismatches the Java validator replaces with ambiguity errors.
    const profile = buildResliceValueProfile();
    const extension = { url: OTHER_ID_URL, valueIdentifier: { value: 'JohnDoe' } };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'AuditEvent', agent: [{ extension: [extension] }] },
      profile.snapshot!.element[3],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([]);
  });

  it('keeps items whose reslice discriminators are distinguishable', () => {
    const npiUrl = 'https://example.org/fhir/StructureDefinition/npi-id';
    const profile = buildResliceValueProfile(npiUrl);
    const subjectExtension = { url: OTHER_ID_URL, valueIdentifier: { value: 'JohnDoe' } };
    const npiExtension = { url: npiUrl, valueIdentifier: { value: '12345' } };

    const scoped = resolveNestedSliceParentItems(
      { resourceType: 'AuditEvent', agent: [{ extension: [subjectExtension, npiExtension] }] },
      profile.snapshot!.element[3],
      profile,
      getValueAtPath,
    );

    expect(scoped).toEqual([subjectExtension]);
  });
});

describe('nested slices below other slices', () => {
  // KBV's Mutterpass fixes the German display of component:SystolicBP's
  // coding; the sub-extension slice below cannot tell its items apart by
  // itself, but the slices around it keep the diastolic component out.
  it('scopes by every enclosing slice where the innermost cannot', () => {
    const GERMAN_DISPLAY = 'https://fhir.kbv.de/StructureDefinition/KBV_EX_Base_Terminology_German';
    const component = (code: string, german: string) => ({ code: { coding: [{
      code,
      display: german,
      _display: { extension: [{ url: GERMAN_DISPLAY, extension: [{ url: 'content', valueString: german }] }] },
    }] } });
    const byUrl = { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' };
    const extensionPath = 'Observation.component.code.coding.display.extension';
    const systolic = 'Observation.component:SystolicBP';
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_MR_Observation_Blood_Pressure',
      type: 'Observation',
      snapshot: { element: [
        { id: 'Observation.component', path: 'Observation.component', slicing: { discriminator: [{ type: 'value', path: 'code.coding.code' }], rules: 'open' } },
        { id: systolic, path: 'Observation.component', sliceName: 'SystolicBP' },
        { id: `${systolic}.code.coding.code`, path: 'Observation.component.code.coding.code', fixedCode: '8480-6' },
        { id: `${systolic}.code.coding.display.extension`, path: extensionPath, slicing: byUrl },
        { id: `${systolic}.code.coding.display.extension:german`, path: extensionPath, sliceName: 'german' },
        { id: `${systolic}.code.coding.display.extension:german.url`, path: `${extensionPath}.url`, fixedUri: GERMAN_DISPLAY },
        { id: `${systolic}.code.coding.display.extension:german.extension`, path: `${extensionPath}.extension`, slicing: byUrl },
        { id: `${systolic}.code.coding.display.extension:german.extension:content`, path: `${extensionPath}.extension`, sliceName: 'content' },
        {
          id: `${systolic}.code.coding.display.extension:german.extension:content.value[x]`,
          path: `${extensionPath}.extension.value[x]`,
          slicing: { discriminator: [{ type: 'type', path: '$this' }], rules: 'closed' },
        },
      ] },
    } as unknown as StructureDefinition;
    const resource = { resourceType: 'Observation', component: [component('8480-6', 'systolischer Blutdruck'), component('8462-4', 'diastolischer Blutdruck')] };
    const valueSlicing = profile.snapshot!.element!.at(-1)!;

    expect(resolveNestedSliceParentItems(resource, valueSlicing, profile, getValueAtPath))
      .toEqual([{ url: 'content', valueString: 'systolischer Blutdruck' }]);
  });
});
