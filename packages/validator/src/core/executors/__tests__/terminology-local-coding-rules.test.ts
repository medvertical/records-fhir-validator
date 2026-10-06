import { describe, expect, it } from 'vitest';
import type { ValueSetValidator } from '../../../validators/valueset-validator';
import { validateDeepLocalCodings } from '../terminology-local-coding-rules';

describe('validateDeepLocalCodings', () => {
  it('terminates safely when an object graph contains a cycle', async () => {
    const resource: Record<string, unknown> = { resourceType: 'Observation' };
    resource.self = resource;

    const issues = await validateDeepLocalCodings(
      resource,
      [],
      {} as ValueSetValidator,
      'R4',
    );

    expect(issues).toEqual([]);
  });
});

describe('validateDeepLocalCodings datatype Coding children', () => {
  const validator = {
    validateCodeInLocalCodeSystemOnly: async (code: string, system: string) => (
      code === 'facility'
        ? { valid: false, issues: [{ severity: 'error', code: 'code-invalid', message: `Unknown code '${code}' in CodeSystem '${system}'` }] }
        : { valid: true, issues: [] }
    ),
  } as unknown as ValueSetValidator;

  it('checks UsageContext.code, which is a Coding not named coding', async () => {
    const issues = await validateDeepLocalCodings(
      {
        resourceType: 'PlanDefinition',
        useContext: [{
          code: { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'facility' },
          valueCodeableConcept: { text: 'x' },
        }],
      },
      [],
      validator,
      'R4',
    );

    expect(issues).toEqual([
      expect.objectContaining({ severity: 'error', path: expect.stringContaining('PlanDefinition.useContext[0].code') }),
    ]);
  });

  it('checks a Quantity code from a local code system wherever the Quantity sits', async () => {
    const orderableDrugForm = 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm';
    const issues = await validateDeepLocalCodings(
      {
        resourceType: 'MedicationStatement',
        dosage: [{ doseAndRate: [{ doseQuantity: { value: 1, unit: 'tab', system: orderableDrugForm, code: 'facility' } }] }],
        extension: [{ url: 'http://example.test/ext', valueQuantity: { value: 2, system: 'http://unitsofmeasure.org', code: 'facility' } }],
      },
      [],
      validator,
      'R4',
    );

    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        path: expect.stringContaining('MedicationStatement.dosage[0].doseAndRate[0].doseQuantity'),
      }),
    ]);
  });

  it('checks the system of a tag or security label, but not its code', async () => {
    const issues = await validateDeepLocalCodings(
      {
        resourceType: 'Practitioner',
        meta: {
          tag: [{ system: '#migrated-from', code: 'STU3' }, { system: 'http://example.org/tags', code: 'facility' }],
          security: [{ system: 'http://hl7.org/fhir/v3/ActReason', code: 'HTEST' }],
        },
      },
      [],
      validator,
      'R4',
    );

    expect(issues.map(issue => [issue.code, issue.severity, issue.path])).toEqual([
      ['terminology-codesystem-url-not-absolute', 'error', 'Practitioner.meta.tag[0].system'],
      ['terminology-codesystem-undefined', 'error', 'Practitioner.meta.security[0].system'],
      ['terminology-codesystem-unresolvable', 'warning', 'Practitioner.meta.security[0].system'],
    ]);
  });

  it('reports a local-label system in a Coding nested below items', async () => {
    const issues = await validateDeepLocalCodings(
      {
        resourceType: 'QuestionnaireResponse',
        item: [{ linkId: '1', item: [{ linkId: '1.1', answer: [{ valueCoding: { system: 'local-codes', code: 'facility' } }] }] }],
      },
      [],
      validator,
      'R4',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'terminology-codesystem-url-not-absolute',
      path: 'QuestionnaireResponse.item[0].item[0].answer[0].valueCoding.system',
    }));
  });

  it('leaves Meta.tag to the application tagging rules', async () => {
    const issues = await validateDeepLocalCodings(
      { resourceType: 'Patient', meta: { tag: [{ system: 'http://example.org/tags', code: 'facility' }] } },
      [],
      validator,
      'R4',
    );

    expect(issues).toEqual([]);
  });
});

describe('validateDeepLocalCodings core-namespace systems', () => {
  const noLocalCodeSystem = {
    validateCodeInLocalCodeSystemOnly: async () => null,
  } as unknown as ValueSetValidator;

  it('reports a retired core system in an extension value, which no package defines', async () => {
    const issues = await validateDeepLocalCodings(
      {
        resourceType: 'Patient',
        extension: [{
          url: 'http://example.test/ext',
          valueCoding: { system: 'http://hl7.org/fhir/v3/ParticipationMode', code: 'ELECTRONIC' },
        }],
      },
      [],
      noLocalCodeSystem,
      'R4',
    );

    expect(issues.map(issue => [issue.code, issue.severity, issue.path])).toEqual([
      ['terminology-codesystem-undefined', 'error', 'Patient.extension[0].valueCoding.system'],
      ['terminology-codesystem-unresolvable', 'warning', 'Patient.extension[0].valueCoding.system'],
    ]);
  });

  it('leaves systems outside the core namespace to the unresolvable-system rules', async () => {
    const issues = await validateDeepLocalCodings(
      {
        resourceType: 'Patient',
        extension: [{ url: 'http://example.test/ext', valueCoding: { system: 'http://example.test/codes', code: 'a' } }],
      },
      [],
      noLocalCodeSystem,
      'R4',
    );

    expect(issues).toEqual([expect.objectContaining({
      code: 'terminology-codesystem-unverified',
      severity: 'information',
      details: expect.objectContaining({ validationComplete: false, validationStatus: 'incomplete' }),
    })]);
  });
});
