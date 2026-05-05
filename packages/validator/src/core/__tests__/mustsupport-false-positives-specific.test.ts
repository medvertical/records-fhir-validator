import { log } from './logger-helper';
/**
 * Specific test for mustSupport false positives with the actual user resource
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { recordsValidator } from '../../index';
import { getValidationTargets } from '../../business-rules';

const ACTUAL_USER_RESOURCE = {
  resourceType: 'Patient',
  id: '424abf1d-142e-42d0-bf5f-a361174c2ddc',
  meta: {
    versionId: 'd8a99ced-b7cf-423f-b692-5a9836bd4099',
    lastUpdated: '2025-10-29T13:10:57.200+00:00',
    profile: [
      'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient'
    ]
  },
  name: [
    {
      use: 'official'
    }
  ],
  birthDate: '2025-10-29'
};

const MII_PATIENT_PROFILE = 'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient';

describe('mustSupport False Positives - User Resource', () => {
  beforeAll(async () => {
    await recordsValidator.waitForInitialization();
  }, 120000);

  it('should not report false positives for existing elements in user resource', async () => {
    const issues = await recordsValidator.validate(
      ACTUAL_USER_RESOURCE,
      MII_PATIENT_PROFILE,
      'R4'
    );

    // Extract all mustsupport-missing issues
    const mustSupportIssues = issues.filter(issue => issue.code === 'mustsupport-missing');

    // Elements that definitely exist and should NOT be reported
    // Note: These are the exact paths from the user's issue
    const falsePositivePaths = [
      'Patient.id',
      'patient.id',
      'id',
      'Patient.meta',
      'patient.meta',
      'meta',
      'Patient.meta.profile',
      'patient.meta.profile',
      'meta.profile',
      'Patient.name',
      'patient.name',
      'name',
      'Patient.name.use',
      'patient.name.use',
      'name.use',
      'Patient.birthDate',
      'patient.birthDate',
      'birthDate',
      'birthdate',
      // Also check for elements that definitely exist but might be reported with different casing
      'patient.id',
      'patient.meta',
      'patient.name',
      'patient.birthdate'
    ];

    // Find false positives
    const falsePositives = mustSupportIssues.filter(issue => {
      const issuePath = issue.path?.toLowerCase() || '';
      return falsePositivePaths.some(fp =>
        issuePath === fp.toLowerCase() ||
        issuePath.includes(fp.toLowerCase().replace('patient.', ''))
      );
    });

    if (falsePositives.length > 0) {
      log.info('\n❌ False positives found:');
      falsePositives.forEach(fp => {
        log.info(`  - ${fp.path} (${fp.code}): ${fp.message}`);
      });

      log.info('\nAll mustSupport issues:');
      mustSupportIssues.forEach(issue => {
        log.info(`  - ${issue.path} (${issue.code}): ${issue.message}`);
      });

      // Debug: Check what getValidationTargets returns for these paths
      log.info('\nDebug getValidationTargets results:');
      for (const fp of falsePositives.slice(0, 5)) {
        const targets = getValidationTargets(ACTUAL_USER_RESOURCE, fp.path || '');
        log.info(`  ${fp.path}: targets=${targets.length}, values=${targets.map(t => JSON.stringify(t.value)).join(', ')}`);
      }
    }

    // These should not be reported as missing
    expect(falsePositives.length).toBe(0);
  }, 120000);

  it('should verify getValidationTargets works for simple properties', () => {
    // Test that getValidationTargets correctly identifies existing simple properties
    const idTargets = getValidationTargets(ACTUAL_USER_RESOURCE, 'Patient.id');
    expect(idTargets.length).toBeGreaterThan(0);
    expect(idTargets[0].value).toBe('424abf1d-142e-42d0-bf5f-a361174c2ddc');

    const metaTargets = getValidationTargets(ACTUAL_USER_RESOURCE, 'Patient.meta');
    expect(metaTargets.length).toBeGreaterThan(0);
    expect(metaTargets[0].value).toBeDefined();
    expect(metaTargets[0].value).toHaveProperty('versionId');

    const nameTargets = getValidationTargets(ACTUAL_USER_RESOURCE, 'Patient.name');
    expect(nameTargets.length).toBeGreaterThan(0);

    const birthDateTargets = getValidationTargets(ACTUAL_USER_RESOURCE, 'Patient.birthDate');
    expect(birthDateTargets.length).toBeGreaterThan(0);
    expect(birthDateTargets[0].value).toBe('2025-10-29');
  });
});
