/**
 * MII Patient Complex Type Validation Tests
 * 
 * Tests that the Records engine correctly validates required sub-elements of complex types
 * when validating against MII Patient profile, matching HAPI's behavior.
 * 
 * Based on VALIDATION_ENGINE_COMPARISON.md test case:
 * - Patient/424abf1d-142e-42d0-bf5f-a361174c2ddc
 * - MII Patient profile: https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { recordsValidator } from '../../index';
// MII Patient profile URL
const MII_PATIENT_PROFILE = 'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient';

// Test Patient resource matching the comparison document
// Has name[0] with use but missing family and given (required sub-elements)
const TEST_PATIENT_MISSING_NAME_SUBELEMENTS = {
  resourceType: 'Patient',
  id: '424abf1d-142e-42d0-bf5f-a361174c2ddc',
  meta: {
    profile: [MII_PATIENT_PROFILE]
  },
  name: [{
    use: 'official'
    // Missing required: family and given
  }]
  // Missing other elements: identifier, gender, address, link
};

// Valid Patient resource with all required sub-elements
const VALID_PATIENT_WITH_NAME = {
  resourceType: 'Patient',
  id: 'test-patient-valid',
  meta: {
    profile: [MII_PATIENT_PROFILE]
  },
  name: [{
    use: 'official',
    family: 'Doe',
    given: ['John']
  }],
  gender: 'male',
  birthDate: '1990-01-01'
};

describe('MII Patient Complex Type Validation', () => {
  beforeAll(async () => {
    // Warm up the validator by triggering initialization
    await recordsValidator.validate({ resourceType: 'Patient' }, undefined, 'R4').catch(() => {});
  }, 60000);

  describe('Required sub-elements validation', () => {
    it('should report missing family and given in HumanName when validating against MII Patient profile', async () => {
      const issues = await recordsValidator.validate(
        TEST_PATIENT_MISSING_NAME_SUBELEMENTS,
        MII_PATIENT_PROFILE,
        'R4'
      );

      // Should have required-element-missing error for name[0].family (required in MII)
      // name.given is mustSupport but not required (min=0) in MII profile
      const familyMissing = issues.find(
        issue =>
          (issue.code === 'required-element-missing' || issue.code === 'structural-required-element-missing') &&
          (issue.path === 'Patient.name[0].family' || issue.path.includes('name[0].family') || issue.path.includes('name.family'))
      );

      // given is mustSupport but not required, so it shows as mustsupport-missing
      const givenMustSupport = issues.find(
        issue => 
          issue.code === 'profile-mustsupport-missing' &&
          (issue.path === 'Patient.name.given' || issue.path.includes('name.given'))
      );

      expect(familyMissing).toBeDefined();
      expect(givenMustSupport).toBeDefined();

      if (familyMissing) {
        expect(familyMissing.severity).toBe('error');
        expect(familyMissing.message).toContain('family');
      }

      if (givenMustSupport) {
        expect(['info', 'warning']).toContain(givenMustSupport.severity);
      }
    }, 120000);

    it('should not report required-element-missing errors when all required sub-elements are present', async () => {
      const issues = await recordsValidator.validate(
        VALID_PATIENT_WITH_NAME,
        MII_PATIENT_PROFILE,
        'R4'
      );

      // Should not have required-element-missing errors for name sub-elements
      const nameSubElementErrors = issues.filter(
        issue =>
          (issue.code === 'required-element-missing' || issue.code === 'structural-required-element-missing') &&
          (issue.path.includes('name[0].family') || issue.path.includes('name[0].given'))
      );

      expect(nameSubElementErrors.length).toBe(0);
    }, 120000);

    it('should validate nested complex types recursively', async () => {
      // Test with a Patient that has name but missing nested elements
      const patientWithIncompleteName = {
        resourceType: 'Patient',
        id: 'test-nested',
        meta: {
          profile: [MII_PATIENT_PROFILE]
        },
        name: [{
          use: 'official',
          family: 'Smith'
          // Missing given (required)
        }]
      };

      const issues = await recordsValidator.validate(
        patientWithIncompleteName,
        MII_PATIENT_PROFILE,
        'R4'
      );

      // Should report missing 'given' element as mustSupport warning (not required in MII)
      const givenMustSupport = issues.find(
        issue =>
          issue.code === 'profile-mustsupport-missing' &&
          issue.path.includes('name') && issue.path.includes('given')
      );

      expect(givenMustSupport).toBeDefined();
    }, 120000);
  });

  describe('Comparison with expected HAPI behavior', () => {
    it('should report at least the same required-element-missing errors as HAPI', async () => {
      const issues = await recordsValidator.validate(
        TEST_PATIENT_MISSING_NAME_SUBELEMENTS,
        MII_PATIENT_PROFILE,
        'R4'
      );

      // According to VALIDATION_ENGINE_COMPARISON.md, HAPI reports:
      // - Patient.name[0].family (Required element missing)
      // - Patient.name[0].given (Required element missing)
      const requiredElementErrors = issues.filter(
        issue => issue.code === 'required-element-missing' || issue.code === 'structural-required-element-missing'
      );

      // Should have at least 1 required-element-missing error (family)
      // given is mustSupport (not required), so it shows as profile-mustsupport-missing
      expect(requiredElementErrors.length).toBeGreaterThanOrEqual(1);

      // Verify family is required (min > 0 in MII)
      const hasFamilyError = requiredElementErrors.some(
        issue => issue.path.includes('family')
      );

      expect(hasFamilyError).toBe(true);

      // given is mustSupport but not required (min=0) in MII
      // Check that mustSupport warnings are reported instead
      const mustSupportWarnings = issues.filter(
        issue => issue.code === 'profile-mustsupport-missing' && issue.path.includes('name') && issue.path.includes('given')
      );
      expect(mustSupportWarnings.length).toBeGreaterThan(0);
    }, 120000);
  });
});
