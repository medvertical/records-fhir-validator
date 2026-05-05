/**
 * Unit Tests for Metadata Executor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetadataExecutor, type MetadataValidationContext } from '../metadata-executor';
// Mock logger
vi.mock('../../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('MetadataExecutor', () => {
  let executor: MetadataExecutor;
  let mockContext: MetadataValidationContext;

  beforeEach(() => {
    executor = new MetadataExecutor();
    mockContext = {
      resource: {
        resourceType: 'Patient',
        id: 'test-001',
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
          lastUpdated: '2024-01-01T00:00:00Z',
          versionId: '1'
        }
      }
    };
  });

  describe('validate', () => {
    it('should return empty array for resource without meta field', async () => {
      mockContext.resource = {
        resourceType: 'Patient',
        id: 'test-001'
      };

      const issues = await executor.validate(mockContext);
      // Missing meta generates info-level issues, not errors
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('should return empty array for valid meta field', async () => {
      const issues = await executor.validate(mockContext);
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('should validate meta.profile is an array', async () => {
      mockContext.resource.meta.profile = 'not-an-array' as any;

      const issues = await executor.validate(mockContext);

      const profileIssue = issues.find(i =>
        i.code === 'metadata-profile-invalid-array' && i.severity === 'error'
      );
      expect(profileIssue).toBeDefined();
      expect(profileIssue?.path).toBe('meta.profile');
    });

    it('should validate meta.profile items are strings', async () => {
      mockContext.resource.meta.profile = ['valid-url', 123, 'another-valid-url'] as any;

      const issues = await executor.validate(mockContext);

      const profileItemIssue = issues.find(i =>
        (i.code === 'metadata-profile-invalid-type' || i.code?.includes('invalid-type')) &&
        i.path?.includes('meta.profile')
      );
      expect(profileItemIssue).toBeDefined();
    });

    it('should validate meta.lastUpdated is a string', async () => {
      mockContext.resource.meta.lastUpdated = 12345 as any;

      const issues = await executor.validate(mockContext);

      const lastUpdatedIssue = issues.find(i =>
        i.code === 'metadata-last-updated-invalid-type' && i.severity === 'error'
      );
      expect(lastUpdatedIssue).toBeDefined();
      expect(lastUpdatedIssue?.path).toBe('meta.lastUpdated');
    });

    it('should validate meta.lastUpdated format (ISO 8601)', async () => {
      mockContext.resource.meta.lastUpdated = 'invalid-date-format';

      const issues = await executor.validate(mockContext);

      const formatIssue = issues.find(i =>
        i.code === 'metadata-last-updated-invalid-format' && i.severity === 'error'
      );
      expect(formatIssue).toBeDefined();
      expect(formatIssue?.path).toBe('meta.lastUpdated');
    });

    it('should accept valid ISO 8601 instant format', async () => {
      const validInstants = [
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z',
        '2024-01-01T00:00:00.123Z',
        '2024-01-01T12:30:45+05:00',
        '2024-01-01T12:30:45-05:00'
      ];

      for (const instant of validInstants) {
        mockContext.resource.meta.lastUpdated = instant;
        const issues = await executor.validate(mockContext);
        const errors = issues.filter(i =>
          i.severity === 'error' && i.path === 'meta.lastUpdated'
        );
        expect(errors).toHaveLength(0);
      }
    });

    it('should validate meta.versionId is a string', async () => {
      mockContext.resource.meta.versionId = 123 as any;

      const issues = await executor.validate(mockContext);

      const versionIdIssue = issues.find(i =>
        i.code === 'metadata-version-id-invalid-type' && i.severity === 'error'
      );
      expect(versionIdIssue).toBeDefined();
      expect(versionIdIssue?.path).toBe('meta.versionId');
    });

    it('should accept any string as versionId (no error)', async () => {
      const versionIds = ['1', '123', 'abc123'];

      for (const versionId of versionIds) {
        mockContext.resource.meta.versionId = versionId;
        const issues = await executor.validate(mockContext);
        const errors = issues.filter(i =>
          i.severity === 'error' && i.path === 'meta.versionId'
        );
        expect(errors).toHaveLength(0);
      }
    });

    it('should handle multiple validation errors', async () => {
      mockContext.resource.meta = {
        profile: 'not-an-array' as any,
        lastUpdated: 12345 as any,
        versionId: 456 as any
      };

      const issues = await executor.validate(mockContext);

      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.some(issue => issue.path === 'meta.profile')).toBe(true);
      expect(issues.some(issue => issue.path === 'meta.lastUpdated')).toBe(true);
      expect(issues.some(issue => issue.path === 'meta.versionId')).toBe(true);
    });

    it('should handle resources with partial meta fields', async () => {
      mockContext.resource.meta = {
        profile: ['http://hl7.org/fhir/StructureDefinition/Patient']
        // Missing lastUpdated and versionId - generates info issues, not errors
      };

      const issues = await executor.validate(mockContext);
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should handle empty meta.profile array', async () => {
      mockContext.resource.meta.profile = [];

      const issues = await executor.validate(mockContext);
      const errors = issues.filter(i =>
        i.severity === 'error' && i.path === 'meta.profile'
      );
      expect(errors).toHaveLength(0);
    });

    it('should handle error during validation gracefully', async () => {
      mockContext.resource = {
        resourceType: 'Patient',
        get meta() {
          throw new Error('Test error');
        }
      };

      const issues = await executor.validate(mockContext);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].aspect).toBe('metadata');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].code).toBe('validation-error');
    });

    it('should handle different resource types', async () => {
      const resourceTypes = ['Patient', 'Observation', 'Condition', 'Encounter'];

      for (const resourceType of resourceTypes) {
        mockContext.resource = {
          resourceType,
          id: 'test-001',
          meta: {
            profile: [`http://hl7.org/fhir/StructureDefinition/${resourceType}`],
            lastUpdated: '2024-01-01T00:00:00Z'
          }
        };

        const issues = await executor.validate(mockContext);
        const errors = issues.filter(i => i.severity === 'error');
        expect(errors).toHaveLength(0);
      }
    });
  });
});
