/**
 * Unit tests for Metadata Completeness Checker
 */

import { describe, it, expect } from 'vitest';
import { validateRequiredMetadata } from '../completeness-checker';

describe('Metadata Completeness Checker', () => {
  describe('validateRequiredMetadata', () => {
    it('should return no issues for resources without requirements', () => {
      const resource = { resourceType: 'UnknownResource' };
      const issues = validateRequiredMetadata(resource, 'UnknownResource');
      expect(issues).toHaveLength(0);
    });

    it('should validate Patient resource requirements', () => {
      const resource = {
        resourceType: 'Patient',
        meta: {
          lastUpdated: '2024-01-01T00:00:00Z',
        },
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      // Patient requires lastUpdated (warning) and versionId (info)
      // lastUpdated is present, versionId is missing
      const versionIdIssue = issues.find(i => i.code === 'required-metadata-missing-versionId');
      expect(versionIdIssue).toBeDefined();
      expect(versionIdIssue?.severity).toBe('info');
    });

    it('should detect missing lastUpdated for Patient', () => {
      const resource = {
        resourceType: 'Patient',
        meta: {},
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      const lastUpdatedIssue = issues.find(i => i.code === 'required-metadata-missing-lastUpdated');
      expect(lastUpdatedIssue).toBeDefined();
      expect(['info', 'warning']).toContain(lastUpdatedIssue?.severity);
      expect(lastUpdatedIssue?.path).toBe('meta.lastUpdated');
    });

    it('should validate Observation resource requirements', () => {
      const resource = {
        resourceType: 'Observation',
        meta: {
          lastUpdated: '2024-01-01T00:00:00Z',
        },
      };
      const issues = validateRequiredMetadata(resource, 'Observation');
      
      // Security labels are policy/profile-specific, not a universal requirement.
      const securityIssue = issues.find(i => i.code === 'required-metadata-missing-security');
      expect(securityIssue).toBeUndefined();
    });

    it('should validate MedicationRequest requirements', () => {
      const resource = {
        resourceType: 'MedicationRequest',
        meta: {},
      };
      const issues = validateRequiredMetadata(resource, 'MedicationRequest');
      
      // MedicationRequest requires lastUpdated and versionId.
      expect(issues.length).toBeGreaterThanOrEqual(2);
      
      const lastUpdatedIssue = issues.find(i => i.code === 'required-metadata-missing-lastUpdated');
      const versionIdIssue = issues.find(i => i.code === 'required-metadata-missing-versionId');
      const securityIssue = issues.find(i => i.code === 'required-metadata-missing-security');
      
      expect(lastUpdatedIssue).toBeDefined();
      expect(versionIdIssue).toBeDefined();
      expect(securityIssue).toBeUndefined();
      
      expect(['info', 'warning']).toContain(lastUpdatedIssue?.severity);
      expect(['info', 'warning']).toContain(versionIdIssue?.severity);
    });

    it('should validate AllergyIntolerance requirements', () => {
      const resource = {
        resourceType: 'AllergyIntolerance',
        meta: {},
      };
      const issues = validateRequiredMetadata(resource, 'AllergyIntolerance');
      
      // AllergyIntolerance requires lastUpdated and versionId.
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });

    it('should validate Consent requirements', () => {
      const resource = {
        resourceType: 'Consent',
        meta: {},
      };
      const issues = validateRequiredMetadata(resource, 'Consent');
      
      // Consent requires lastUpdated and versionId by the generic checker.
      expect(issues.length).toBeGreaterThanOrEqual(2);
      
      const securityIssue = issues.find(i => i.code === 'required-metadata-missing-security');
      expect(securityIssue).toBeUndefined();
    });

    it('should validate profile field presence', () => {
      const resource = {
        resourceType: 'Patient',
        meta: {
          profile: ['http://example.com/StructureDefinition/PatientProfile'],
        },
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      // Profile is not required for Patient, so no issues
      const profileIssue = issues.find(i => i.code === 'required-metadata-missing-profile');
      expect(profileIssue).toBeUndefined();
    });

    it('should validate tag field presence', () => {
      const resource = {
        resourceType: 'Patient',
        meta: {
          tag: [{ system: 'http://example.com/tags', code: 'tag1' }],
        },
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      // Tag is not required for Patient, so no issues
      const tagIssue = issues.find(i => i.code === 'required-metadata-missing-tag');
      expect(tagIssue).toBeUndefined();
    });

    it('should validate source field presence', () => {
      const resource = {
        resourceType: 'Patient',
        meta: {
          source: 'http://example.com/source',
        },
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      // Source is not required for Patient, so no issues
      const sourceIssue = issues.find(i => i.code === 'required-metadata-missing-source');
      expect(sourceIssue).toBeUndefined();
    });

    it('should handle resources with all required metadata', () => {
      const resource = {
        resourceType: 'Patient',
        meta: {
          lastUpdated: '2024-01-01T00:00:00Z',
          versionId: '1',
        },
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      // All required fields are present
      expect(issues.length).toBe(0);
    });

    it('should handle resources without meta field', () => {
      const resource = {
        resourceType: 'Patient',
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      // Should detect missing lastUpdated and versionId
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every(i => i.path.startsWith('meta.'))).toBe(true);
    });

    it('should not require security labels by default', () => {
      const resource = {
        resourceType: 'Observation',
        meta: {
          lastUpdated: '2024-01-01T00:00:00Z',
          security: [],
        },
      };
      const issues = validateRequiredMetadata(resource, 'Observation');
      
      const securityIssue = issues.find(i => i.code === 'required-metadata-missing-security');
      expect(securityIssue).toBeUndefined();
    });

    it('should include proper issue details', () => {
      const resource = {
        resourceType: 'Patient',
      };
      const issues = validateRequiredMetadata(resource, 'Patient');
      
      expect(issues.length).toBeGreaterThan(0);
      
      const issue = issues[0];
      expect(issue.aspect).toBe('metadata');
      expect(issue.resourceType).toBe('Patient');
      expect(issue.details).toBeDefined();
      expect(issue.details?.resourceType).toBe('Patient');
      expect(issue.details?.fieldPath).toBeDefined();
      expect(issue.details?.requiredField).toBeDefined();
    });
  });
});


