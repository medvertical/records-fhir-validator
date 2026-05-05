/**
 * Unit tests for R6 Support Warnings
 * Task 2.10: Tests for R6 limited support warning generation
 * 
 * Tests:
 * - R6 warning creation for different aspects
 * - Warning type variations (general, terminology, profile, reference)
 * - shouldAddR6Warning logic
 * - addR6WarningIfNeeded integration
 * - R6 support summary
 * 
 * Target: 90%+ coverage
 * File size: <400 lines
 */

import { describe, it, expect } from 'vitest';
import {
  isR6,
  createR6Warning,
  shouldAddR6Warning,
  addR6WarningIfNeeded,
  getR6SupportSummary,
  type _R6WarningType,
} from './r6-support-warnings';
import type { ValidationIssue } from '../types/validation-types';

// ============================================================================
// Test Suite
// ============================================================================

describe('R6 Support Warnings (Task 2.10)', () => {
  // ==========================================================================
  // Version Detection
  // ==========================================================================

  describe('Version Detection', () => {
    it('should detect R6 version', () => {
      expect(isR6('R6')).toBe(true);
    });

    it('should not detect R4 as R6', () => {
      expect(isR6('R4')).toBe(false);
    });

    it('should not detect R5 as R6', () => {
      expect(isR6('R5')).toBe(false);
    });

    it('should handle undefined version', () => {
      expect(isR6(undefined)).toBe(false);
    });

    it('should handle null version', () => {
      expect(isR6(null as any)).toBe(false);
    });
  });

  // ==========================================================================
  // Warning Creation
  // ==========================================================================

  describe('Warning Creation', () => {
    it('should create general R6 warning', () => {
      const warning = createR6Warning('structural', 'general');

      expect(warning.aspect).toBe('structural');
      expect(warning.severity).toBe('info');
      expect(warning.code).toBe('r6-support-limited');
      expect(warning.message).toContain('R6');
      expect(warning.message).toContain('partial support');
    });

    it('should create terminology R6 warning', () => {
      const warning = createR6Warning('terminology', 'terminology');

      expect(warning.aspect).toBe('terminology');
      expect(warning.severity).toBe('info');
      expect(warning.code).toBe('r6-terminology-limited');
      expect(warning.message).toContain('terminology validation');
      expect(warning.message).toContain('limited');
    });

    it('should create profile R6 warning', () => {
      const warning = createR6Warning('profile', 'profile');

      expect(warning.aspect).toBe('profile');
      expect(warning.severity).toBe('info');
      expect(warning.code).toBe('r6-profile-limited');
      expect(warning.message).toContain('profile validation');
      expect(warning.message).toContain('limited package availability');
    });

    it('should create reference R6 warning', () => {
      const warning = createR6Warning('reference', 'reference');

      expect(warning.aspect).toBe('reference');
      expect(warning.severity).toBe('info');
      expect(warning.code).toBe('r6-reference-limited');
      expect(warning.message).toContain('reference validation');
      expect(warning.message).toContain('may have issues');
    });

    it('should include additional context in warning', () => {
      const context = 'Additional details about limitation.';
      const warning = createR6Warning('structural', 'general', context);

      expect(warning.message).toContain(context);
    });

    it('should generate unique warning IDs', () => {
      const warning1 = createR6Warning('structural', 'general');
      const warning2 = createR6Warning('structural', 'general');

      expect(warning1.id).not.toBe(warning2.id);
    });

    it('should include timestamp in warning', () => {
      const warning = createR6Warning('structural', 'general');

      expect(warning.timestamp).toBeInstanceOf(Date);
      expect(warning.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  // ==========================================================================
  // Should Add Warning Logic
  // ==========================================================================

  describe('Should Add Warning Logic', () => {
    it('should add warning for R6 terminology', () => {
      expect(shouldAddR6Warning('R6', 'terminology')).toBe(true);
    });

    it('should add warning for R6 profile', () => {
      expect(shouldAddR6Warning('R6', 'profile')).toBe(true);
    });

    it('should add warning for R6 reference', () => {
      expect(shouldAddR6Warning('R6', 'reference')).toBe(true);
    });

    it('should not add warning for R6 structural', () => {
      // Structural validation works fine for R6
      expect(shouldAddR6Warning('R6', 'structural')).toBe(false);
    });

    it('should not add warning for R6 metadata', () => {
      // Metadata validation works fine for R6
      expect(shouldAddR6Warning('R6', 'metadata')).toBe(false);
    });

    it('should not add warning for R6 businessRule', () => {
      // Business rules work fine for R6
      expect(shouldAddR6Warning('R6', 'businessRule')).toBe(false);
    });

    it('should not add warning for R4 terminology', () => {
      expect(shouldAddR6Warning('R4', 'terminology')).toBe(false);
    });

    it('should not add warning for R5 profile', () => {
      expect(shouldAddR6Warning('R5', 'profile')).toBe(false);
    });

    it('should not add warning for undefined version', () => {
      expect(shouldAddR6Warning(undefined, 'terminology')).toBe(false);
    });
  });

  // ==========================================================================
  // Add Warning If Needed
  // ==========================================================================

  describe('Add Warning If Needed', () => {
    it('should add R6 warning to empty issues for R6 terminology', () => {
      const issues: ValidationIssue[] = [];
      const result = addR6WarningIfNeeded(issues, 'R6', 'terminology');

      expect(result.length).toBe(1);
      expect(result[0].code).toBe('r6-terminology-limited');
      expect(result[0].severity).toBe('info');
    });

    it('should prepend R6 warning to existing issues', () => {
      const existingIssue: ValidationIssue = {
        id: 'test-1',
        aspect: 'terminology',
        severity: 'error',
        code: 'test-error',
        message: 'Test error',
        path: '',
        timestamp: new Date(),
      };
      const issues: ValidationIssue[] = [existingIssue];
      const result = addR6WarningIfNeeded(issues, 'R6', 'terminology');

      expect(result.length).toBe(2);
      expect(result[0].code).toContain('r6-');
      expect(result[1]).toBe(existingIssue);
    });

    it('should not add duplicate R6 warning', () => {
      const r6Warning = createR6Warning('terminology', 'terminology');
      const issues: ValidationIssue[] = [r6Warning];
      const result = addR6WarningIfNeeded(issues, 'R6', 'terminology');

      expect(result.length).toBe(1);
      expect(result).toBe(issues);
    });

    it('should not add warning for R4', () => {
      const issues: ValidationIssue[] = [];
      const result = addR6WarningIfNeeded(issues, 'R4', 'terminology');

      expect(result.length).toBe(0);
      expect(result).toBe(issues);
    });

    it('should not add warning for non-limited aspects', () => {
      const issues: ValidationIssue[] = [];
      const result = addR6WarningIfNeeded(issues, 'R6', 'structural');

      expect(result.length).toBe(0);
      expect(result).toBe(issues);
    });

    it('should use aspect as warning type if not provided', () => {
      const issues: ValidationIssue[] = [];
      const result = addR6WarningIfNeeded(issues, 'R6', 'profile');

      expect(result.length).toBe(1);
      expect(result[0].code).toBe('r6-profile-limited');
    });
  });

  // ==========================================================================
  // R6 Support Summary
  // ==========================================================================

  describe('R6 Support Summary', () => {
    it('should return R6 support summary', () => {
      const summary = getR6SupportSummary();

      expect(summary.version).toContain('R6');
      expect(summary.supportStatus).toBe('partial');
      expect(summary.supportedAspects).toBeInstanceOf(Array);
      expect(summary.limitedAspects).toBeInstanceOf(Array);
      expect(summary.limitations).toBeInstanceOf(Array);
    });

    it('should list supported aspects', () => {
      const summary = getR6SupportSummary();

      expect(summary.supportedAspects.length).toBeGreaterThan(0);
      expect(summary.supportedAspects.some(a => a.includes('Structure'))).toBe(true);
      expect(summary.supportedAspects.some(a => a.includes('Profile'))).toBe(true);
    });

    it('should list limited aspects', () => {
      const summary = getR6SupportSummary();

      expect(summary.limitedAspects.length).toBeGreaterThan(0);
      expect(summary.limitedAspects.some(a => a.includes('Terminology'))).toBe(true);
      expect(summary.limitedAspects.some(a => a.includes('Profile packages'))).toBe(true);
      expect(summary.limitedAspects.some(a => a.includes('Reference'))).toBe(true);
    });

    it('should include limitations from config', () => {
      const summary = getR6SupportSummary();

      expect(summary.limitations.length).toBeGreaterThan(0);
      expect(summary.limitations.some(l => l.includes('Terminology'))).toBe(true);
    });
  });

  // ==========================================================================
  // Integration Scenarios
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('should handle R6 terminology validation workflow', () => {
      // Simulating terminology validation for R6
      const issues: ValidationIssue[] = [
        {
          id: 'term-1',
          aspect: 'terminology',
          severity: 'error',
          code: 'unknown-code',
          message: 'Code not found',
          path: 'code',
          timestamp: new Date(),
        },
      ];

      const result = addR6WarningIfNeeded(issues, 'R6', 'terminology');

      expect(result.length).toBe(2);
      expect(result[0].severity).toBe('info');
      expect(result[0].code).toContain('r6-terminology');
      expect(result[1].severity).toBe('error');
    });

    it('should handle R6 profile validation workflow', () => {
      // Simulating profile validation for R6
      const issues: ValidationIssue[] = [
        {
          id: 'profile-1',
          aspect: 'profile',
          severity: 'warning',
          code: 'profile-not-found',
          message: 'Profile package not available',
          path: 'meta.profile',
          timestamp: new Date(),
        },
      ];

      const result = addR6WarningIfNeeded(issues, 'R6', 'profile');

      expect(result.length).toBe(2);
      expect(result[0].code).toBe('r6-profile-limited');
    });

    it('should not interfere with R4/R5 validation', () => {
      const r4Issues: ValidationIssue[] = [
        {
          id: 'test-1',
          aspect: 'terminology',
          severity: 'error',
          code: 'test-error',
          message: 'Test',
          path: '',
          timestamp: new Date(),
        },
      ];

      const r4Result = addR6WarningIfNeeded(r4Issues, 'R4', 'terminology');
      const r5Result = addR6WarningIfNeeded(r4Issues, 'R5', 'terminology');

      expect(r4Result).toBe(r4Issues);
      expect(r5Result).toBe(r4Issues);
      expect(r4Result.length).toBe(1);
      expect(r5Result.length).toBe(1);
    });
  });
});

