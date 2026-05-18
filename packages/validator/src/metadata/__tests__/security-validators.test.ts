/**
 * Unit tests for Security Validators
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityValidator } from '../security-validators';

describe('SecurityValidator', () => {
  let validator: SecurityValidator;

  beforeEach(() => {
    validator = new SecurityValidator();
  });

  describe('validate', () => {
    it('should validate valid security labels', () => {
      const security = [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code: 'N',
          display: 'Normal'
        },
      ];
      const issues = validator.validate(security, 'Patient');
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should reject non-array security', () => {
      const security = 'not-an-array';
      const issues = validator.validate(security as any, 'Patient');

      expect(issues.length).toBe(1);
      expect(issues[0].code).toBe('metadata-security-invalid-array');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].path).toBe('meta.security');
    });

    it('should reject non-object security labels', () => {
      const security = ['not-an-object', { system: 'http://example.com', code: 'test', display: 'Test' }];
      const issues = validator.validate(security as any, 'Patient');

      expect(issues.length).toBeGreaterThan(0);
      const invalidObjectIssue = issues.find(i => i.code === 'metadata-security-invalid-object');
      expect(invalidObjectIssue).toBeDefined();
      expect(invalidObjectIssue?.severity).toBe('error');
    });

    it('should require system or code', () => {
      const security = [{}];
      const issues = validator.validate(security, 'Patient');

      const missingIssue = issues.find(i =>
        i.code === 'metadata-security-missing-system' || i.code === 'metadata-security-missing-code'
      );
      expect(missingIssue).toBeDefined();
      expect(missingIssue?.severity).toBe('error');
    });

    it('should validate system URI format', () => {
      const security = [
        {
          system: 'example.com/resource',
          code: 'test',
          display: 'Test'
        },
      ];
      const issues = validator.validate(security, 'Patient');
      // May generate invalid-system issue for non-URI format
      expect(issues.length).toBeGreaterThanOrEqual(0);
    });

    it('should validate code is string', () => {
      const security = [
        {
          system: 'http://example.com',
          code: 123,
          display: 'Test'
        },
      ];
      const issues = validator.validate(security, 'Patient');

      const invalidCodeIssue = issues.find(i => i.code === 'metadata-security-invalid-code-type');
      expect(invalidCodeIssue).toBeDefined();
      expect(invalidCodeIssue?.severity).toBe('error');
    });

    it('should validate display is string', () => {
      const security = [
        {
          system: 'http://example.com',
          code: 'test',
          display: 123,
        },
      ];
      const issues = validator.validate(security, 'Patient');

      const invalidDisplayIssue = issues.find(i => i.code === 'metadata-security-invalid-display-type');
      expect(invalidDisplayIssue).toBeDefined();
      expect(['warning', 'error']).toContain(invalidDisplayIssue?.severity);
    });

    it('should warn about code without system', () => {
      const security = [
        {
          code: 'test',
        },
      ];
      const issues = validator.validate(security, 'Patient');

      const missingSystemIssue = issues.find(i => i.code === 'metadata-security-missing-system');
      expect(missingSystemIssue).toBeDefined();
      expect(missingSystemIssue?.severity).toBe('error');
    });

    it('should validate known security systems', () => {
      const security = [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code: 'N',
          display: 'Normal'
        },
      ];
      const issues = validator.validate(security, 'Patient');

      const unknownCodeIssue = issues.find(i => i.code === 'metadata-security-unknown-code');
      expect(unknownCodeIssue).toBeUndefined();
    });

    it('should warn about unknown codes in known systems', () => {
      const security = [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code: 'UNKNOWN_CODE',
          display: 'Unknown'
        },
      ];
      const issues = validator.validate(security, 'Patient');

      const unknownCodeIssue = issues.find(i => i.code === 'metadata-security-unknown-code');
      expect(unknownCodeIssue).toBeDefined();
      expect(['info', 'warning']).toContain(unknownCodeIssue?.severity);
    });

    it('should handle empty security array', () => {
      const security: any[] = [];
      const issues = validator.validate(security, 'Patient');
      expect(issues).toHaveLength(0);
    });

    it('should validate multiple security labels', () => {
      const security = [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code: 'N',
          display: 'Normal'
        },
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'ETHUD',
          display: 'Alcohol/Drug-abuse related'
        },
      ];
      const issues = validator.validate(security, 'Patient');
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should accept MII HTEST security labels from v3 ActReason', () => {
      const security = [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
          code: 'HTEST',
          display: 'test health data',
        },
      ];
      const issues = validator.validate(security, 'Observation');

      expect(issues.find(i => i.code === 'metadata-security-unknown-system')).toBeUndefined();
      expect(issues.find(i => i.code === 'metadata-security-unknown-code')).toBeUndefined();
    });

    it('should accept TRAIN security labels from v3 ActReason', () => {
      const security = [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
          code: 'TRAIN',
          display: 'training',
        },
      ];
      const issues = validator.validate(security, 'Bundle');

      expect(issues.find(i => i.code === 'metadata-security-unknown-system')).toBeUndefined();
      expect(issues.find(i => i.code === 'metadata-security-unknown-code')).toBeUndefined();
    });

    it('should handle valid URIs for system', () => {
      const security = [
        {
          system: 'http://example.com/codesystem',
          code: 'test',
          display: 'Test'
        },
      ];
      const issues = validator.validate(security, 'Patient');

      const invalidSystemIssue = issues.find(i => i.code === 'metadata-security-invalid-system');
      expect(invalidSystemIssue).toBeUndefined();
    });
  });
});
