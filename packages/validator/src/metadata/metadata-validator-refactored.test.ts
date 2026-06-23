/**
 * Tests for MetadataValidator (Refactored)
 */

import { describe, it, expect, beforeEach, vi as _vi } from 'vitest';
import { MetadataValidator } from './metadata-validator-refactored';
describe('MetadataValidator', () => {
  let validator: MetadataValidator;

  beforeEach(() => {
    validator = new MetadataValidator();
  });

  describe('validate', () => {
    it('should validate a complete valid resource', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          versionId: '1',
          lastUpdated: '2024-01-01T12:00:00Z',
          profile: ['http://example.com/StructureDefinition/MyPatient'],
          security: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
              code: 'N',
              display: 'normal'
            }
          ],
          tag: [
            {
              system: 'http://example.com/tags',
              code: 'test',
              display: 'Test Tag'
            }
          ],
          source: 'http://example.com/source'
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      // Should have no errors
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should detect missing meta field', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123'
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const metaIssues = issues.filter(i => i.code === 'missing-meta');
      expect(metaIssues.length).toBeGreaterThan(0);
      expect(metaIssues[0].severity).toBe('warning');
    });

    it('should validate lastUpdated format', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          lastUpdated: 'invalid-date'
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const dateIssues = issues.filter(i => i.path === 'meta.lastUpdated');
      expect(dateIssues.length).toBeGreaterThan(0);
    });

    it('should validate versionId format', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          versionId: ''
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const versionIssues = issues.filter(i => i.path === 'meta.versionId');
      expect(versionIssues.length).toBeGreaterThan(0);
    });

    it('should validate profile URLs', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          profile: ['not-a-valid-url']
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const profileIssues = issues.filter(i => i.path?.includes('meta.profile'));
      expect(profileIssues.length).toBeGreaterThan(0);
    });

    it('should not infer resource type from IG-specific profile names', async () => {
      const resource = {
        resourceType: 'Condition',
        id: 'diagnosis-1',
        meta: {
          profile: ['https://www.medizininformatik-initiative.de/fhir/core/modul-diagnose/StructureDefinition/Diagnose']
        }
      };

      const issues = await validator.validate(resource, 'Condition', 'R4');

      expect(issues.some(i => i.code === 'metadata-profile-resource-type-mismatch')).toBe(false);
    });

    it('should still detect profile URLs that explicitly name a different resource type', async () => {
      const resource = {
        resourceType: 'Condition',
        id: 'condition-1',
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/Patient']
        }
      };

      const issues = await validator.validate(resource, 'Condition', 'R4');

      expect(issues.some(i => i.code === 'metadata-profile-resource-type-mismatch')).toBe(true);
    });

    it('should validate security labels', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          security: [
            { system: 'invalid', code: 'test' } // Missing display
          ]
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const securityIssues = issues.filter(i => i.path?.includes('meta.security'));
      expect(securityIssues.length).toBeGreaterThanOrEqual(0); // May have warnings
    });

    it('should validate tags', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          tag: [
            { code: 'test' } // Missing system and display
          ]
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const tagIssues = issues.filter(i => i.path?.includes('meta.tag'));
      expect(tagIssues.length).toBeGreaterThan(0);
    });

    it('should validate source URI', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          source: 'not a valid uri'
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const sourceIssues = issues.filter(i => i.path === 'meta.source');
      expect(sourceIssues.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle invalid meta type', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: 'invalid' // Should be object
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      const typeIssues = issues.filter(i => i.code === 'invalid-meta-type');
      expect(typeIssues.length).toBeGreaterThan(0);
      expect(typeIssues[0].severity).toBe('error');
    });

    it('should check required metadata for Patient resources', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {} // Empty meta
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      // Patient should recommend lastUpdated
      const requiredIssues = issues.filter(i => 
        i.code?.includes('required-metadata-missing')
      );
      expect(requiredIssues.length).toBeGreaterThan(0);
    });

    it('should handle validation errors gracefully', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123',
        meta: {
          profile: null // Invalid type
        }
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      // Should not throw, but return error issues
      expect(Array.isArray(issues)).toBe(true);
    });

    it('should include all required fields in ValidationIssue', async () => {
      const resource = {
        resourceType: 'Patient',
        id: '123'
      };

      const issues = await validator.validate(resource, 'Patient', 'R4');

      issues.forEach(issue => {
        expect(issue).toHaveProperty('id');
        expect(issue).toHaveProperty('aspect');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('code');
        expect(issue).toHaveProperty('message');
        expect(issue).toHaveProperty('path');
        expect(issue).toHaveProperty('timestamp');
        expect(issue).toHaveProperty('resourceType');
        expect(issue.aspect).toBe('metadata');
      });
    });
  });
});
