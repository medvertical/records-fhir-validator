import { describe, expect, it } from 'vitest';
import { ValueSetValidator } from '../valueset-validator';

const IDENTIFIER_TYPE = 'http://hl7.org/fhir/ValueSet/identifier-type';

describe('a bound CodeableConcept without a coding', () => {
  const validator = new ValueSetValidator();

  it('asks for a code from an extensible value set, as the reference validator does', async () => {
    const issues = await validator.validateBinding(
      { text: 'Local id' },
      { strength: 'extensible', valueSet: IDENTIFIER_TYPE },
      'Patient.identifier[0].type',
    );

    expect(issues).toEqual([expect.objectContaining({
      code: 'terminology-binding-extensible-no-code',
      severity: 'warning',
      path: 'Patient.identifier[0].type',
    })]);
  });

  it('stays quiet for preferred bindings and for a bare Coding', async () => {
    await expect(validator.validateBinding(
      { text: 'Local id' },
      { strength: 'preferred', valueSet: IDENTIFIER_TYPE },
      'Patient.identifier[0].type',
    )).resolves.toEqual([]);
    await expect(validator.validateBinding(
      { system: 'http://terminology.hl7.org/CodeSystem/v2-0203' },
      { strength: 'extensible', valueSet: IDENTIFIER_TYPE },
      'Patient.identifier[0].type.coding[0]',
    )).resolves.toEqual([]);
  });

  it('treats codings with nothing but a display as no code, and says each lacks a system', async () => {
    const issues = await validator.validateBinding(
      { coding: [{ display: 'INSURANCE-ID' }, { system: 'http://terminology.hl7.org/CodeSystem/v2-0203' }] },
      { strength: 'extensible', valueSet: IDENTIFIER_TYPE },
      'Coverage.identifier[0].type',
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'terminology-coding-missing-system', severity: 'warning', path: 'Coverage.identifier[0].type.coding[0]',
      }),
      expect.objectContaining({
        code: 'terminology-binding-extensible-no-code', severity: 'warning', path: 'Coverage.identifier[0].type',
      }),
    ]);
  });
});
