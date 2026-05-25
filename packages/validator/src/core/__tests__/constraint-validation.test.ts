/**
 * Constraint Validation Tests
 *
 * Tests for FHIRPath constraint evaluation including core constraints (dom-2 through dom-6)
 * and profile-specific constraints (pat-de-1).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ConstraintValidator } from '../../validators/constraint-validator';

// Helper to find a constraint violation by key
const findConstraintIssue = (issues: any[], constraintKey: string) =>
  issues.find(i => (i.ruleId === constraintKey || i.details?.constraintKey === constraintKey) &&
    (i.code === constraintKey || i.code === 'profile-constraint-violation' || i.code === 'profile-constraint-warning' || i.code?.includes('constraint')));

// Minimal inline element definitions with core FHIR DomainResource constraints
const PATIENT_ELEMENTS_WITH_CONSTRAINTS = [
  {
    id: 'Patient',
    path: 'Patient',
    constraint: [
      { key: 'dom-2', severity: 'error' as const, human: 'If the resource is contained in another resource, it SHALL NOT contain nested Resources', expression: 'contained.contained.empty()' },
      { key: 'dom-3', severity: 'error' as const, human: 'If the resource is contained in another resource, it SHALL be referred to from elsewhere in the resource', expression: "contained.where((('#'+id in (%resource.descendants().reference | %resource.descendants().as(canonical) | %resource.descendants().as(uri) | %resource.descendants().as(url))) or descendants().where(reference = '#').exists() or descendants().where(as(canonical) = '#').exists() or descendants().where(as(uri) = '#').exists() or descendants().where(as(url) = '#').exists()).not()).trace('unmatched', id).empty()" },
      { key: 'dom-4', severity: 'error' as const, human: 'If a resource is contained in another resource, it SHALL NOT have a meta.versionId or a meta.lastUpdated', expression: 'contained.meta.versionId.empty() and contained.meta.lastUpdated.empty()' },
      { key: 'dom-5', severity: 'error' as const, human: 'If a resource is contained in another resource, it SHALL NOT have a security label', expression: 'contained.meta.security.empty()' },
      { key: 'dom-6', severity: 'warning' as const, human: 'A resource should have narrative for robust management', expression: "text.`div`.exists()" },
    ]
  }
];

describe('Constraint Validation', () => {
  let constraintValidator: ConstraintValidator;

  beforeAll(() => {
    constraintValidator = new ConstraintValidator();
  });

  describe('Core FHIR Constraints (dom-2 through dom-6)', () => {
    it('should evaluate dom-2: contained.contained.empty()', async () => {
      const resourceWithNestedContained = {
        resourceType: 'Patient',
        id: 'test-patient',
        contained: [{
          resourceType: 'Organization',
          id: 'org1',
          contained: [{
            resourceType: 'Practitioner',
            id: 'prac1'
          }]
        }]
      };

      const issues = await constraintValidator.validate(
        resourceWithNestedContained,
        PATIENT_ELEMENTS_WITH_CONSTRAINTS,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      const dom2Violation = findConstraintIssue(issues, 'dom-2');
      expect(dom2Violation).toBeDefined();
      expect(dom2Violation?.severity).toBe('error');
    }, 120000);

    it('should evaluate dom-3: contained references must be valid', async () => {
      const resourceWithUnreferencedContained = {
        resourceType: 'Patient',
        id: 'test-patient',
        contained: [{
          resourceType: 'Organization',
          id: 'org1'
        }]
        // No reference to #org1 anywhere in the resource
      };

      const issues = await constraintValidator.validate(
        resourceWithUnreferencedContained,
        PATIENT_ELEMENTS_WITH_CONSTRAINTS,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      const dom3Violation = findConstraintIssue(issues, 'dom-3');
      expect(dom3Violation).toBeDefined();
      expect(['error', 'warning']).toContain(dom3Violation?.severity);
    }, 120000);

    it('should pass dom-3 when contained resources are referenced locally', async () => {
      const resourceWithReferencedContained = {
        resourceType: 'Patient',
        id: 'test-patient',
        contained: [{
          resourceType: 'Organization',
          id: 'org1'
        }],
        managingOrganization: {
          reference: '#org1'
        }
      };

      const issues = await constraintValidator.validate(
        resourceWithReferencedContained,
        PATIENT_ELEMENTS_WITH_CONSTRAINTS,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      expect(findConstraintIssue(issues, 'dom-3')).toBeUndefined();
      expect(issues.find(issue => issue.code === 'profile-constraint-evaluation-error')).toBeUndefined();
    }, 120000);

    it('should evaluate dom-4: contained resources should not have meta.versionId', async () => {
      const resourceWithContainedVersionId = {
        resourceType: 'Patient',
        id: 'test-patient',
        contained: [{
          resourceType: 'Organization',
          id: 'org1',
          meta: { versionId: '1' }
        }]
      };

      const issues = await constraintValidator.validate(
        resourceWithContainedVersionId,
        PATIENT_ELEMENTS_WITH_CONSTRAINTS,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      const dom4Violation = findConstraintIssue(issues, 'dom-4');
      expect(dom4Violation).toBeDefined();
      expect(dom4Violation?.severity).toBe('error');
    }, 120000);

    it('should evaluate dom-5: contained resources should not have security labels', async () => {
      const resourceWithContainedSecurity = {
        resourceType: 'Patient',
        id: 'test-patient',
        contained: [{
          resourceType: 'Organization',
          id: 'org1',
          meta: {
            security: [{
              system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
              code: 'R'
            }]
          }
        }]
      };

      const issues = await constraintValidator.validate(
        resourceWithContainedSecurity,
        PATIENT_ELEMENTS_WITH_CONSTRAINTS,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      const dom5Violation = findConstraintIssue(issues, 'dom-5');
      expect(dom5Violation).toBeDefined();
      expect(dom5Violation?.severity).toBe('error');
    }, 120000);

    it('should evaluate dom-6: resource should have narrative', async () => {
      const resourceWithoutNarrative = {
        resourceType: 'Patient',
        id: 'test-patient'
        // No text.div element
      };

      const issues = await constraintValidator.validate(
        resourceWithoutNarrative,
        PATIENT_ELEMENTS_WITH_CONSTRAINTS,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      const dom6Violation = findConstraintIssue(issues, 'dom-6');
      expect(dom6Violation).toBeDefined();
      // dom-6 is a warning but may be demoted to info in standard mode
      expect(['warning', 'info']).toContain(dom6Violation?.severity);
      expect(dom6Violation?.code).toBe('dom-6');
      expect(dom6Violation?.path).toBe('Patient.text');
    }, 120000);
  });

  describe('Profile-Specific Constraints', () => {
    it('should evaluate pat-de-1: gender extension validation', async () => {
      const miiElements = [
        {
          id: 'Patient',
          path: 'Patient',
          constraint: [
            {
              key: 'pat-de-1',
              severity: 'error' as const,
              human: 'Falls die Geschlechtsangabe other ist, muss eine Differenzierung vorliegen',
              expression: "gender.exists() implies (_gender.extension('http://fhir.de/StructureDefinition/gender-amtlich-de').exists().not() or gender = 'other')"
            }
          ]
        }
      ];

      // Patient with gender extension but gender != 'other' (violates pat-de-1)
      const resourceWithInvalidGenderExtension = {
        resourceType: 'Patient',
        id: 'test-patient',
        gender: 'male',
        _gender: {
          extension: [{
            url: 'http://fhir.de/StructureDefinition/gender-amtlich-de',
            valueCoding: {
              system: 'http://fhir.de/CodeSystem/gender-amtlich-de',
              code: 'D'
            }
          }]
        }
      };

      const issues = await constraintValidator.validate(
        resourceWithInvalidGenderExtension,
        miiElements,
        'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient'
      );

      const patDe1Violation = findConstraintIssue(issues, 'pat-de-1');
      expect(patDe1Violation).toBeDefined();
      expect(patDe1Violation?.severity).toBe('error');
    }, 120000);
  });

  describe('Constraint Evaluation Logic', () => {
    it('should always evaluate root element constraints', async () => {
      const mockElements = [{
        id: 'Patient',
        path: 'Patient',
        constraint: [{
          key: 'test-constraint',
          severity: 'error' as const,
          human: 'Test constraint that should always be evaluated',
          expression: 'true' // This will pass
        }]
      }];

      const resource = { resourceType: 'Patient', id: 'test' };

      const issues = await constraintValidator.validate(
        resource,
        mockElements,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      // Should have evaluated the constraint (no violations since expression is 'true')
      expect(issues.length).toBe(0);
    }, 120000);

    it('should skip constraints for missing optional elements', async () => {
      const mockElements = [{
        id: 'Patient.optionalField',
        path: 'Patient.optionalField',
        min: 0, // Optional
        constraint: [{
          key: 'test-constraint',
          severity: 'error' as const,
          human: 'Test constraint that should be skipped',
          expression: 'false' // This would fail if evaluated
        }]
      }];

      const resource = { resourceType: 'Patient', id: 'test' }; // optionalField not present

      const issues = await constraintValidator.validate(
        resource,
        mockElements,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      // Should not have evaluated the constraint (no violations)
      expect(issues.length).toBe(0);
    }, 120000);
  });
});
