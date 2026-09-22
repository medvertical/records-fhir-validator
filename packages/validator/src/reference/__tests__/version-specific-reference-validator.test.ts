/**
 * Version-Specific Reference Validator Unit Tests
 * 
 * Tests for validating version-specific references and checking integrity.
 * Validates version parsing, consistency checking, and availability verification.
 * 
 * Task 6.8: Unit tests for version-specific reference validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VersionSpecificReferenceValidator,
  getVersionSpecificReferenceValidator,
  resetVersionSpecificReferenceValidator
} from '../version-specific-reference-validator';

// ============================================================================
// Test Suite
// ============================================================================

describe('VersionSpecificReferenceValidator', () => {
  let validator: VersionSpecificReferenceValidator;

  beforeEach(() => {
    resetVersionSpecificReferenceValidator();
    validator = getVersionSpecificReferenceValidator();
  });

  // ========================================================================
  // Version Parsing Tests
  // ========================================================================

  describe('Version Parsing', () => {
    it('should parse versioned _history reference', () => {
      const result = validator.parseVersionedReference('Patient/123/_history/5');

      expect(result.isVersioned).toBe(true);
      expect(result.resourceType).toBe('Patient');
      expect(result.resourceId).toBe('123');
      expect(result.versionId).toBe('5');
      expect(result.isValidVersionFormat).toBe(true);
    });

    it('should parse non-versioned reference', () => {
      const result = validator.parseVersionedReference('Patient/123');

      expect(result.isVersioned).toBe(false);
      expect(result.resourceType).toBe('Patient');
      expect(result.resourceId).toBe('123');
      expect(result.versionId).toBeUndefined();
    });

    it('should parse versioned canonical URL', () => {
      const result = validator.parseVersionedReference(
        'http://example.com/fhir/StructureDefinition/custom-profile|2.0.0'
      );

      expect(result.isVersioned).toBe(true);
      expect(result.versionId).toBe('2.0.0');
      expect(result.isValidVersionFormat).toBe(true);
    });

    it('should handle absolute URL with _history', () => {
      const result = validator.parseVersionedReference(
        'https://server.example.com/fhir/Patient/123/_history/2'
      );

      expect(result.isVersioned).toBe(true);
      expect(result.versionId).toBe('2');
    });

    it('should detect invalid version format', () => {
      // Non-numeric version ID for _history
      const result = validator.parseVersionedReference('Patient/123/_history/abc');

      expect(result.isVersioned).toBe(true);
      expect(result.isValidVersionFormat).toBe(false);
    });
  });

  // ========================================================================
  // Version Validation Tests
  // ========================================================================

  describe('Version Validation', () => {
    it('should validate correct versioned reference', () => {
      const result = validator.validateVersionedReference('Patient/123/_history/5');

      expect(result.isValid).toBe(true);
      expect(result.severity).toBe('info');
    });

    it('should reject invalid version format', () => {
      const result = validator.validateVersionedReference('Patient/123/_history/invalid');

      expect(result.isValid).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('Invalid version format');
    });

    it('should handle non-versioned reference gracefully', () => {
      const result = validator.validateVersionedReference('Patient/123');

      expect(result.isValid).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.message).toContain('not versioned');
    });

    it('should reject versioned reference without resource type', () => {
      const result = validator.validateVersionedReference('123/_history/5');

      expect(result.isValid).toBe(false);
      expect(result.severity).toBe('error');
    });
  });

  // ========================================================================
  // Consistency Checking Tests
  // ========================================================================

  describe('Consistency Checking', () => {
    it('should detect inconsistent versions', () => {
      const references = [
        'Patient/123/_history/1',
        'Patient/123/_history/2',
      ];

      const result = validator.checkVersionConsistency(references);

      expect(result.isConsistent).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].issue).toContain('different versions');
    });

    it('should detect mixed versioned and non-versioned references', () => {
      const references = [
        'Patient/123/_history/1',
        'Patient/123',
      ];

      const result = validator.checkVersionConsistency(references);

      expect(result.isConsistent).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].issue).toContain('both versioned and non-versioned');
    });

    it('should pass consistent references', () => {
      const references = [
        'Patient/123/_history/1',
        'Patient/456/_history/1',
        'Observation/789/_history/2',
      ];

      const result = validator.checkVersionConsistency(references);

      expect(result.isConsistent).toBe(true);
      expect(result.issues.length).toBe(0);
    });

    it('should pass all non-versioned references', () => {
      const references = [
        'Patient/123',
        'Patient/456',
        'Observation/789',
      ];

      const result = validator.checkVersionConsistency(references);

      expect(result.isConsistent).toBe(true);
      expect(result.issues.length).toBe(0);
    });
  });

  // ========================================================================
  // Version Extraction Tests
  // ========================================================================

  describe('Version Extraction', () => {
    it('should extract versioned references from resource', () => {
      const resource = {
        resourceType: 'DiagnosticReport',
        id: 'report1',
        basedOn: [
          { reference: 'ServiceRequest/req1/_history/2' },
        ],
        subject: { reference: 'Patient/pat1/_history/1' },
      };

      const result = validator.extractVersionedReferences(resource);

      expect(result.length).toBe(2);
      expect(result[0].versionId).toBeDefined();
      expect(result[1].versionId).toBeDefined();
    });

    it('should not extract non-versioned references', () => {
      const resource = {
        resourceType: 'Observation',
        id: 'obs1',
        subject: { reference: 'Patient/pat1' },
        performer: [{ reference: 'Practitioner/pract1' }],
      };

      const result = validator.extractVersionedReferences(resource);

      expect(result.length).toBe(0);
    });

    it('should handle nested references', () => {
      const resource = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              subject: { reference: 'Patient/123/_history/5' },
            },
          },
        ],
      };

      const result = validator.extractVersionedReferences(resource);

      expect(result.length).toBe(1);
      expect(result[0].versionId).toBe('5');
    });
  });

  // ========================================================================
  // Resource Validation Tests
  // ========================================================================

  describe('Resource Validation', () => {
    it('should validate all versioned references in resource', () => {
      const resource = {
        resourceType: 'DiagnosticReport',
        id: 'report1',
        basedOn: [
          { reference: 'ServiceRequest/req1/_history/2' },
          { reference: 'ServiceRequest/req2/_history/invalid' },
        ],
      };

      const results = validator.validateResourceVersionedReferences(resource);

      expect(results.length).toBe(2);
      expect(results[0].isValid).toBe(true);
      expect(results[1].isValid).toBe(false);
    });

    it('should return empty array for resource without versioned references', () => {
      const resource = {
        resourceType: 'Patient',
        id: 'pat1',
        managingOrganization: { reference: 'Organization/org1' },
      };

      const results = validator.validateResourceVersionedReferences(resource);

      expect(results.length).toBe(0);
    });
  });

  // ========================================================================
  // Version Comparison Tests
  // ========================================================================

  describe('Version Comparison', () => {
    it('should compare numeric versions correctly', () => {
      expect(validator.compareVersions('1', '2')).toBeLessThan(0);
      expect(validator.compareVersions('2', '1')).toBeGreaterThan(0);
      expect(validator.compareVersions('5', '5')).toBe(0);
    });

    it('should compare multi-digit versions', () => {
      expect(validator.compareVersions('10', '2')).toBeGreaterThan(0);
      expect(validator.compareVersions('100', '99')).toBeGreaterThan(0);
    });

    it('should fallback to string comparison for non-numeric versions', () => {
      const result = validator.compareVersions('1.0.0', '2.0.0');
      expect(result).toBeLessThan(0);
    });
  });

  // ========================================================================
  // Latest Version Tests
  // ========================================================================

  describe('Latest Version', () => {
    it('should find latest version', () => {
      const references = [
        'Patient/123/_history/1',
        'Patient/123/_history/5',
        'Patient/123/_history/3',
      ];

      const latest = validator.getLatestVersion(references);

      expect(latest).not.toBeNull();
      expect(latest!.versionId).toBe('5');
    });

    it('should return null for no versioned references', () => {
      const references = ['Patient/123', 'Patient/456'];

      const latest = validator.getLatestVersion(references);

      expect(latest).toBeNull();
    });

    it('should check if reference is latest version', () => {
      const references = [
        'Patient/123/_history/1',
        'Patient/123/_history/5',
        'Patient/123/_history/3',
      ];

      expect(validator.isLatestVersion('Patient/123/_history/5', references)).toBe(true);
      expect(validator.isLatestVersion('Patient/123/_history/1', references)).toBe(false);
    });
  });

  // ========================================================================
  // Reference Conversion Tests
  // ========================================================================

  describe('Reference Conversion', () => {
    it('should convert regular reference to versioned', () => {
      const versioned = validator.toVersionedReference('Patient/123', '5');

      expect(versioned).toBe('Patient/123/_history/5');
    });

    it('should convert absolute URL to versioned', () => {
      const versioned = validator.toVersionedReference(
        'https://server.example.com/fhir/Patient/123',
        '2'
      );

      expect(versioned).toBe('https://server.example.com/fhir/Patient/123/_history/2');
    });

    it('should convert canonical URL to versioned', () => {
      const versioned = validator.toVersionedReference(
        'http://example.com/fhir/StructureDefinition/profile',
        '2.0.0'
      );

      expect(versioned).toBe('http://example.com/fhir/StructureDefinition/profile|2.0.0');
    });

    it('should strip version from versioned reference', () => {
      const stripped = validator.stripVersion('Patient/123/_history/5');

      expect(stripped).toBe('Patient/123');
    });

    it('should return unchanged if not versioned', () => {
      const stripped = validator.stripVersion('Patient/123');

      expect(stripped).toBe('Patient/123');
    });
  });

  // ========================================================================
  // Bundle Validation Tests
  // ========================================================================

  describe('Bundle Validation', () => {
    it('should validate Bundle version integrity', () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              subject: { reference: 'Patient/123/_history/1' },
            },
          },
          {
            resource: {
              resourceType: 'DiagnosticReport',
              subject: { reference: 'Patient/123/_history/2' },
            },
          },
        ],
      };

      const result = validator.validateBundleVersionIntegrity(bundle);

      expect(result.isValid).toBe(false); // Inconsistent versions
      expect(result.consistencyCheck.issues.length).toBeGreaterThan(0);
    });

    it('should pass Bundle with consistent versions', () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              subject: { reference: 'Patient/123/_history/1' },
            },
          },
          {
            resource: {
              resourceType: 'DiagnosticReport',
              subject: { reference: 'Patient/456/_history/1' },
            },
          },
        ],
      };

      const result = validator.validateBundleVersionIntegrity(bundle);

      expect(result.isValid).toBe(true);
    });
  });

  // ========================================================================
  // Availability Checking Tests
  // ========================================================================

  describe('Availability Checking', () => {
    it('should check availability with HTTP client', async () => {
      const mockClient = async (_url: string) => ({
        status: 200,
        data: {
          resourceType: 'Patient',
          id: '123',
          meta: { versionId: '5' },
        },
      });

      const result = await validator.checkVersionAvailability(
        'Patient/123/_history/5',
        mockClient
      );

      expect(result.isAvailable).toBe(true);
      expect(result.httpStatus).toBe(200);
      expect(result.actualVersion).toBe('5');
    });

    it('should detect version mismatch', async () => {
      const mockClient = async (_url: string) => ({
        status: 200,
        data: {
          resourceType: 'Patient',
          id: '123',
          meta: { versionId: '6' }, // Different version!
        },
      });

      const result = await validator.checkVersionAvailability(
        'Patient/123/_history/5',
        mockClient
      );

      expect(result.isAvailable).toBe(true);
      expect(result.actualVersion).toBe('6');
      expect(result.errorMessage).toContain('mismatch');
    });

    it('should handle 404 not found', async () => {
      const mockClient = async (_url: string) => ({
        status: 404,
      });

      const result = await validator.checkVersionAvailability(
        'Patient/123/_history/999',
        mockClient
      );

      expect(result.isAvailable).toBe(false);
      expect(result.httpStatus).toBe(404);
      expect(result.errorMessage).toContain('not found');
    });

    it('should require HTTP client', async () => {
      const result = await validator.checkVersionAvailability('Patient/123/_history/5');

      expect(result.isAvailable).toBe(false);
      expect(result.errorMessage).toContain('No HTTP client');
    });

    it('should handle network errors', async () => {
      const mockClient = async (_url: string) => {
        throw new Error('request failed for https://user:secret@internal.example/private');
      };

      const result = await validator.checkVersionAvailability(
        'Patient/123/_history/5',
        mockClient
      );

      expect(result.isAvailable).toBe(false);
      expect(result.errorMessage).toBe('Reference target request failed');
      expect(result.errorMessage).not.toContain('secret');
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle empty reference', () => {
      const result = validator.parseVersionedReference('');

      expect(result.isVersioned).toBe(false);
    });

    it('should handle malformed _history reference', () => {
      const result = validator.parseVersionedReference('Patient/123/_history/');

      expect(result.isVersioned).toBe(false);
    });

    it('should handle reference with extra slashes', () => {
      const result = validator.parseVersionedReference('Patient/123/_history/5/extra');

      // Should not match the pattern
      expect(result.isVersioned).toBe(false);
    });

    it('should handle whitespace in reference', () => {
      const result = validator.parseVersionedReference('  Patient/123/_history/5  ');

      expect(result.isVersioned).toBe(true);
      expect(result.versionId).toBe('5');
    });
  });
});
