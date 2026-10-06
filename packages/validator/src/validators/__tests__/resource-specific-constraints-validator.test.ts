import { describe, expect, it } from 'vitest';
import { resourceSpecificConstraintsValidator } from '../resource-specific-constraints-validator';

const MII_MEDICATION_STATEMENT_PROFILE =
  'https://www.medizininformatik-initiative.de/fhir/core/modul-medikation/StructureDefinition/MedicationStatement|2026.0.1';

describe('ResourceSpecificConstraintsValidator Condition constraints', () => {
  it('does not report con-3 for encounter-diagnosis Conditions without clinicalStatus', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: 'encounter-diagnosis',
        }],
      }],
    });

    expect(issues.find(issue => issue.ruleId === 'con-3')).toBeUndefined();
  });

  it('reports con-3 for problem-list Conditions without clinicalStatus', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      verificationStatus: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
        }],
      },
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: 'problem-list-item',
        }],
      }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-constraint-warning',
      severity: 'warning',
      path: 'Condition.clinicalStatus',
      ruleId: 'con-3',
    }));
  });

  it('does not report con-3 when verificationStatus is entered-in-error', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      verificationStatus: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'entered-in-error',
        }],
      },
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: 'problem-list-item',
        }],
      }],
    });

    expect(issues.find(issue => issue.ruleId === 'con-3')).toBeUndefined();
  });

  it('does not report con-5 for confirmed encounter-diagnosis Conditions without clinicalStatus', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      verificationStatus: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
        }],
      },
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: 'encounter-diagnosis',
        }],
      }],
    });

    expect(issues.find(issue => issue.code === 'con-5-violation')).toBeUndefined();
  });

  it('reports con-5 when entered-in-error Conditions include clinicalStatus', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      clinicalStatus: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
        }],
      },
      verificationStatus: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'entered-in-error',
        }],
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'con-5-violation',
      severity: 'error',
      path: 'Condition.clinicalStatus',
    }));
  });

  it('uses the status-system coding even when another coding appears first', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      clinicalStatus: {
        coding: [
          { system: 'http://example.org/status', code: 'custom' },
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          null,
          { system: 'http://example.org/status', code: 'custom' },
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'entered-in-error',
          },
        ],
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'con-5-violation',
    }));
  });

  it('does not treat a colliding category code from another system as problem-list-item', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Condition',
      category: [{
        coding: [{
          system: 'http://example.org/custom-category',
          code: 'problem-list-item',
        }],
      }],
    });

    expect(issues.find(issue => issue.ruleId === 'con-3')).toBeUndefined();
  });
});

describe('ResourceSpecificConstraintsValidator malformed and repeated structures', () => {
  it('ignores malformed Patient contacts and rejects null-only telecom arrays', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Patient',
      contact: [
        null,
        42,
        {},
        { telecom: [null] },
        { telecom: [{ system: 'phone', value: '123' }] },
      ],
    });

    expect(issues.filter(issue => issue.code === 'pat-1-violation').map(issue => issue.path)).toEqual([
      'Patient.contact[2]',
      'Patient.contact[3]',
    ]);
  });

  it('checks Bundle entry rules without crashing on malformed siblings', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Bundle',
      type: 'collection',
      total: null,
      entry: [
        null,
        42,
        { request: {} },
        { response: {} },
      ],
    });

    expect(issues.map(issue => issue.code)).toEqual([
      'bdl-3-violation',
      'bdl-4-violation',
    ]);
    expect(issues.map(issue => issue.path)).toEqual([
      'Bundle.entry[2].request',
      'Bundle.entry[3].response',
    ]);
  });

  it('reports nested empty Composition sections at their concrete path', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Composition',
      section: [{
        section: [{}],
      }],
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'cmp-1-violation',
        path: 'Composition.section[0].section[0]',
      }),
    ]);
  });

  it('counts a section Narrative without its div as present text for cmp-1, as FHIRPath does', () => {
    const issues = resourceSpecificConstraintsValidator.validate({
      resourceType: 'Composition',
      section: [{ title: 'History', text: { status: 'generated' } }],
    });

    expect(issues.filter(issue => issue.code === 'cmp-1-violation')).toEqual([]);
  });

  it('contains cyclic Composition sections', () => {
    const section: Record<string, unknown> = {};
    section.section = [section];

    expect(() => resourceSpecificConstraintsValidator.validate({
      resourceType: 'Composition',
      section: [section],
    })).not.toThrow();
  });

  it('ignores resources without a usable resourceType', () => {
    expect(resourceSpecificConstraintsValidator.validate(null)).toEqual([]);
    expect(resourceSpecificConstraintsValidator.validate({ resourceType: 42 })).toEqual([]);
  });
});

describe('ResourceSpecificConstraintsValidator German medication dosage rules', () => {
  it('reports mixed free-text and structured DosageDE usage as a warning', () => {
    const issues = resourceSpecificConstraintsValidator.validate(
      {
        resourceType: 'MedicationStatement',
        dosage: [
          {
            text: '1-0-1-0',
            timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } },
          },
        ],
      },
      [],
      MII_MEDICATION_STATEMENT_PROFILE,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-constraint-warning',
      severity: 'warning',
      path: 'MedicationStatement.dosage[0]',
      ruleId: 'DosageStructuredOrFreeTextWarning',
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-constraint-warning',
      severity: 'warning',
      path: 'MedicationStatement.dosage[0]',
      ruleId: 'DosageWarnungViererschemaInText',
    }));
  });

  it('reports partial structured dosage without both timing and doseAndRate as an error', () => {
    const issues = resourceSpecificConstraintsValidator.validate(
      {
        resourceType: 'MedicationStatement',
        dosage: [
          {
            timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd' } },
          },
        ],
      },
      [],
      MII_MEDICATION_STATEMENT_PROFILE,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-constraint-violation',
      severity: 'error',
      path: 'MedicationStatement.dosage[0]',
      ruleId: 'DosageStructuredRequiresBoth',
    }));
  });

  it('does not run DosageDE rules outside German medication profiles', () => {
    const issues = resourceSpecificConstraintsValidator.validate(
      {
        resourceType: 'MedicationStatement',
        dosage: [
          {
            text: '1-0-1-0',
            timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } },
          },
        ],
      },
      [],
      'http://hl7.org/fhir/StructureDefinition/MedicationStatement',
    );

    expect(issues).toHaveLength(0);
  });
});
