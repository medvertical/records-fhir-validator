import { describe, expect, it } from 'vitest';
import { resourceSpecificConstraintsValidator } from '../resource-specific-constraints-validator';

const MII_MEDICATION_STATEMENT_PROFILE =
  'https://www.medizininformatik-initiative.de/fhir/core/modul-medikation/StructureDefinition/MedicationStatement|2026.0.1';

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
