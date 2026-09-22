import { beforeEach, describe, expect, it } from 'vitest';
import { ValueSetValidator as BaseValueSetValidator } from '../valueset-validator';
import { ValueSetCache } from '../valueset-cache';
import { getScopedExpansionCacheKey } from '../valueset-server-routing';
import { DEFAULT_RESOLUTION_CONFIG } from '../valueset-types';

const valueSetCache = new ValueSetCache();
class ValueSetValidator extends BaseValueSetValidator {
  constructor() {
    super(valueSetCache);
  }
}

beforeEach(() => {
  valueSetCache.clear();
});

function setExpandedCodes(valueSetUrl: string, codes: Set<string>): void {
  valueSetCache.setExpandedCodes(valueSetUrl, codes);
  valueSetCache.setExpandedCodes(
    getScopedExpansionCacheKey(valueSetUrl, DEFAULT_RESOLUTION_CONFIG),
    codes,
  );
}

describe('ValueSetValidator required primitive bindings', () => {
  it('does not emit value-set mismatch diagnostics for missing or empty codes', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|known`, 'known']));

    const validator = new ValueSetValidator();

    await expect(validator.validateBinding(
      '',
      { strength: 'required', valueSet: valueSetUrl },
      'Patient.gender',
    )).resolves.toHaveLength(0);

    await expect(validator.validateBinding(
      { system: systemUrl, code: '' },
      { strength: 'extensible', valueSet: valueSetUrl },
      'Patient.contact.relationship',
    )).resolves.toHaveLength(0);

    await expect(validator.validateBinding(
      { coding: [{ system: systemUrl, code: '' }] },
      { strength: 'extensible', valueSet: valueSetUrl },
      'Patient.contact.relationship',
    )).resolves.toHaveLength(0);

    await expect(validator.validateBinding(
      { coding: [{ system: systemUrl }] },
      { strength: 'required', valueSet: valueSetUrl },
      'Patient.contact.relationship',
    )).resolves.toHaveLength(0);
  });

  it('rejects invalid administrative-gender codes from local expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'invalid-code',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1',
      },
      'Patient.gender',
    );

    // A bare code fails twice over: its system cannot be determined, and the
    // value is not in the value set. The violation comes first.
    expect(issues).toHaveLength(2);
    expect(issues[0].code).toBe('terminology-binding-required-code');
    expect(issues[0].path).toBe('Patient.gender');
    expect(issues[0].details?.resourceType).toBe('Patient');
  });

  it('does not satisfy a required CodeableConcept binding with a system-less Coding', async () => {
    const valueSetUrl = 'http://hl7.org/fhir/ValueSet/allergyintolerance-clinical|4.0.1';
    setExpandedCodes(valueSetUrl, new Set([
      'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical|active',
      'active',
    ]));
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      { coding: [{ code: 'active' }] },
      { strength: 'required', valueSet: valueSetUrl },
      'AllergyIntolerance.clinicalStatus',
      { fhirVersion: 'R4' },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'terminology-binding-required-code',
      path: 'AllergyIntolerance.clinicalStatus',
    }));
  });

  it('accepts active in the R4 AllergyIntolerance clinical status value set', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        }],
      },
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/allergyintolerance-clinical|4.0.1',
      },
      'AllergyIntolerance.clinicalStatus',
      { fhirVersion: 'R4' },
    );

    expect(issues).toHaveLength(0);
  });

  it('rejects invalid observation-status codes from local expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'invalid-status',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/observation-status|4.0.1',
      },
      'Observation.status',
    );

    // A bare code fails twice over: its system cannot be determined, and the
    // value is not in the value set. The violation comes first.
    expect(issues).toHaveLength(2);
    expect(issues[0].code).toBe('terminology-binding-required-code');
    expect(issues[0].path).toBe('Observation.status');
    expect(issues[0].details?.resourceType).toBe('Observation');
  });

  it('uses versioned package expansion for R6 observation-status codes', async () => {
    const validator = new ValueSetValidator();

    const r6Issues = await validator.validateBinding(
      'specimen-in-process',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/observation-status|6.0.0-ballot4',
      },
      'Observation.status',
      { fhirVersion: 'R6' },
    );
    expect(r6Issues).toHaveLength(0);

    const r4Issues = await validator.validateBinding(
      'specimen-in-process',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/observation-status|4.0.1',
      },
      'Observation.status',
      { fhirVersion: 'R4' },
    );
    // A bare code fails twice over: its system cannot be determined, and the
    // value is not in the value set. The violation comes first.
    expect(r4Issues).toHaveLength(2);
    expect(r4Issues[0]).toEqual(expect.objectContaining({
      code: 'terminology-binding-required-code',
      path: 'Observation.status',
    }));
  });

  it('keeps invalid binding errors but suggests known CodeSystem canonical fixes', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-verstatus',
          code: 'confirmed',
        }],
      },
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/condition-ver-status|4.0.1',
      },
      'Condition.verificationStatus',
      { fhirVersion: 'R4' },
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-binding-required');
    expect(issues[0].details).toMatchObject({
      suggestedSystem: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
      fixHint: expect.stringContaining('condition-ver-status'),
    });
  });

  it('accepts valid Device.deviceName.type codes from local expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'model-name',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/device-nametype|4.0.1',
      },
      'Device.deviceName.type',
    );

    expect(issues).toHaveLength(0);
  });

  it('accepts the published MII Onkologie CodeSystem predecessor canonical', async () => {
    const valueSetUrl =
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/ValueSet/mii-vs-systemische-therapie-stellungzurop';
    const predecessorSystem =
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/CodeSystem/mii-cs-therapie-stellungzurop';
    const currentSystem =
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-onko/CodeSystem/mii-cs-onko-therapie-stellungzurop';
    setExpandedCodes(valueSetUrl, new Set([`${currentSystem}|N`, 'N']));

    const issues = await new ValueSetValidator().validateBinding(
      {
        coding: [{
          system: predecessorSystem,
          code: 'N',
          display: 'neoadjuvant',
        }],
      },
      { strength: 'required', valueSet: valueSetUrl },
      'Procedure.extension.valueCodeableConcept',
      { fhirVersion: 'R4' },
    );

    expect(issues).toHaveLength(0);
  });

  it('accepts valid R5 Device.name.type codes from versioned package expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'registered-name',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/device-nametype|5.0.0',
      },
      'Device.name[0].type',
      { fhirVersion: 'R5' },
    );

    expect(issues).toHaveLength(0);
  });

  it('rejects R4-only Device name type codes against the R5 binding', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'model-name',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/device-nametype|5.0.0',
      },
      'Device.name[0].type',
      { fhirVersion: 'R5' },
    );

    // A bare code fails twice over: its system cannot be determined, and the
    // value is not in the value set. The violation comes first.
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual(expect.objectContaining({
      code: 'terminology-binding-required-code',
      path: 'Device.name[0].type',
    }));
  });

  it('errors when Coding.display differs from a required binding CodeSystem concept display', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|code`, 'code']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{ code: 'code', display: 'Expected Display' }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: systemUrl,
          code: 'code',
          display: 'Wrong Display',
        }],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Condition.code',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-display-mismatch');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].path).toBe('Condition.code.coding[0].display');
    expect(issues[0].details).toMatchObject({
      code: 'code',
      system: systemUrl,
      display: 'Wrong Display',
      expectedDisplay: 'Expected Display',
      valueSet: valueSetUrl,
      bindingStrength: 'required',
    });
  });

  it('treats a wildcard ValueSet include version as unconstrained', async () => {
    const valueSetUrl = 'http://example.test/ValueSet/versioned-ops';
    const systemUrl = 'http://fhir.de/CodeSystem/bfarm/ops';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl, version: '*' }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|5-470.0`, '5-470.0']));

    const validator = new ValueSetValidator();
    const issues = await validator.validateBinding(
      {
        coding: [{
          system: systemUrl,
          version: '2020',
          code: '5-470.0',
        }],
      },
      { strength: 'required', valueSet: valueSetUrl },
      'Procedure.code',
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'terminology-code-system-version-mismatch',
    }));
  });

  it('uses the binding strength for CodeSystem version mismatch severity', async () => {
    const valueSetUrl = 'http://example.test/ValueSet/versioned-ops-strength';
    const systemUrl = 'http://fhir.de/CodeSystem/bfarm/ops';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl, version: '2026' }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|5-470.0`, '5-470.0']));

    const validate = (strength: 'required' | 'extensible' | 'preferred') =>
      new ValueSetValidator().validateBinding(
        {
          coding: [{
            system: systemUrl,
            version: '2020',
            code: '5-470.0',
          }],
        },
        { strength, valueSet: valueSetUrl },
        'Procedure.category',
      );

    await expect(validate('required')).resolves.toContainEqual(expect.objectContaining({
      code: 'terminology-code-system-version-mismatch',
      severity: 'error',
    }));
    await expect(validate('extensible')).resolves.toContainEqual(expect.objectContaining({
      code: 'terminology-code-system-version-mismatch',
      severity: 'warning',
    }));
    await expect(validate('preferred')).resolves.toContainEqual(expect.objectContaining({
      code: 'terminology-code-system-version-mismatch',
      severity: 'information',
    }));
  });

  it('does not warn when Coding.display only differs in case or whitespace', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|vital-signs`, 'vital-signs']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{ code: 'vital-signs', display: 'Vital Signs' }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: systemUrl,
          code: 'vital-signs',
          display: '  vital   signs ',
        }],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Observation.category',
    );

    expect(issues).toHaveLength(0);
  });

  it('accepts CodeSystem concept designations as valid Coding.display values', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|code`, 'code']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{
        code: 'code',
        display: 'Canonical Display',
        designation: [{
          language: 'en',
          value: 'Accepted Alias',
        }],
      }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: systemUrl,
          code: 'code',
          display: 'Accepted Alias',
        }],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Observation.code',
    );

    expect(issues).toHaveLength(0);
  });

  it('accepts a CodeableConcept when a later Coding satisfies the binding', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|valid`, 'valid']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{ code: 'valid', display: 'Valid Display' }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [
          { code: 'local-only', display: 'Local Label' },
          { system: systemUrl, code: 'valid', display: 'Valid Display' },
        ],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Observation.code',
    );

    expect(issues).toHaveLength(0);

    const invalidOnlyIssues = await validator.validateBinding(
      {
        coding: [
          { code: 'local-only', display: 'Local Label' },
        ],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Observation.code',
    );

    // A systemless Coding cannot establish required membership; the separate
    // Coding hygiene pass owns the missing-system diagnostic.
    expect(invalidOnlyIssues).toHaveLength(1);
    expect(invalidOnlyIssues[0].code).toBe('terminology-binding-required-code');
  });

  it('reports display mismatches on the matching Coding index', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|valid`, 'valid']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{ code: 'valid', display: 'Valid Display' }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [
          { code: 'local-only', display: 'Local Label' },
          { system: systemUrl, code: 'valid', display: 'Wrong Display' },
        ],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Observation.code',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-display-mismatch');
    expect(issues[0].path).toBe('Observation.code.coding[1].display');
  });

  it('keeps unversioned ValueSet lookups isolated by requested FHIR version', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const binding = {
      strength: 'extensible' as const,
      valueSet: 'http://hl7.org/fhir/ValueSet/provenance-activity-type',
    };
    const coding = {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
        code: 'CREATE',
      }],
    };

    const r5Issues = await validator.validateBinding(coding, binding, 'Provenance.activity', {
      fhirVersion: 'R5',
    });
    expect(r5Issues).toHaveLength(1);
    expect(r5Issues[0].code).toBe('terminology-binding-extensible');

    const r4Issues = await validator.validateBinding(coding, binding, 'Provenance.activity', {
      fhirVersion: 'R4',
    });
    expect(r4Issues).toHaveLength(0);
  });
});
