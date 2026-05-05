import { logger as log } from '../../logger';
/**
 * mustSupport False Positives Test
 * 
 * Tests to verify that mustSupport validation doesn't report false positives
 * for elements that actually exist in the resource.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { recordsValidator } from '../../index';

const TEST_PATIENT = {
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

describe('mustSupport False Positives', () => {
  beforeAll(async () => {
    await recordsValidator.waitForInitialization();
  }, 120000);

  it('should not report false positives for existing elements', async () => {
    const issues = await recordsValidator.validate(
      TEST_PATIENT,
      MII_PATIENT_PROFILE,
      'R4'
    );

    // Elements that exist should NOT be reported as mustsupport-missing
    const _falsePositives = issues.filter(issue => 
      issue.code === 'profile-mustsupport-missing' &&
      (issue.path === 'Patient.id' || 
       issue.path === 'patient.id' ||
       issue.path?.includes('id') && issue.path?.startsWith('Patient'))
    );

    // Check specifically for known false positives
    const idMissing = issues.find(i => 
      i.code === 'profile-mustsupport-missing' && 
      (i.path === 'Patient.id' || i.path === 'patient.id' || i.path === 'id')
    );
    
    const metaMissing = issues.find(i => 
      i.code === 'profile-mustsupport-missing' && 
      (i.path === 'Patient.meta' || i.path === 'patient.meta' || i.path === 'meta')
    );
    
    const nameMissing = issues.find(i => 
      i.code === 'profile-mustsupport-missing' && 
      (i.path === 'Patient.name' || i.path === 'patient.name' || i.path === 'name') &&
      !i.path.includes('family') && !i.path.includes('given')
    );
    
    const birthDateMissing = issues.find(i => 
      i.code === 'profile-mustsupport-missing' && 
      (i.path === 'Patient.birthDate' || i.path === 'patient.birthDate' || i.path === 'birthDate' || i.path === 'birthdate')
    );

    // Log for debugging
    if (idMissing || metaMissing || nameMissing || birthDateMissing) {
      log.info('False positives found:');
      if (idMissing) log.info('  - Patient.id is missing:', idMissing);
      if (metaMissing) log.info('  - Patient.meta is missing:', metaMissing);
      if (nameMissing) log.info('  - Patient.name is missing:', nameMissing);
      if (birthDateMissing) log.info('  - Patient.birthDate is missing:', birthDateMissing);
    }

    // These elements exist, so they should NOT be reported as missing
    expect(idMissing).toBeUndefined();
    expect(metaMissing).toBeUndefined();
    expect(nameMissing).toBeUndefined();
    expect(birthDateMissing).toBeUndefined();
  }, 120000);

  it('should still report legitimate mustSupport violations', async () => {
    const testPatientMissingMustSupport = {
      resourceType: 'Patient',
      id: 'test-missing-mustsupport',
      meta: {
        profile: [MII_PATIENT_PROFILE]
      }
      // Missing: identifier, gender, address, link (mustSupport in MII)
    };

    const issues = await recordsValidator.validate(
      testPatientMissingMustSupport,
      MII_PATIENT_PROFILE,
      'R4'
    );

    // Should report missing mustSupport elements that are actually missing
    const identifierMissing = issues.find(i => 
      i.code === 'profile-mustsupport-missing' && 
      i.path?.includes('identifier')
    );
    
    const genderMissing = issues.find(i => 
      i.code === 'profile-mustsupport-missing' && 
      i.path?.includes('gender')
    );

    // These should be reported as they're actually missing
    expect(identifierMissing).toBeDefined();
    expect(genderMissing).toBeDefined();
  }, 120000);
});





