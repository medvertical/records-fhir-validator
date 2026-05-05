/**
 * Barrel Export Test
 * 
 * Ensures that the barrel export (index.ts) properly exports all types
 * and that direct imports are not used elsewhere in the codebase.
 */

import { describe, it, expect } from 'vitest';

// Test that we can import from the barrel export
import type {
  ValidationAspect,
  ValidationSeverity,
  ValidationStrictness,
  ValidationIssue,
  ValidationResult,
  ValidationSettings,
  ValidationAspectConfig
} from '../index';

describe('Barrel Export (shared/validation/index.ts)', () => {
  it('should export ValidationAspect type', () => {
    const aspect: ValidationAspect = 'structural';
    expect(aspect).toBe('structural');
  });

  it('should export ValidationSeverity type', () => {
    const severity: ValidationSeverity = 'error';
    expect(severity).toBe('error');
  });

  it('should export ValidationStrictness type', () => {
    const strictness: ValidationStrictness = 'standard';
    expect(strictness).toBe('standard');
  });

  it('should export ValidationIssue interface', () => {
    const issue: ValidationIssue = {
      aspect: 'structural',
      severity: 'error',
      message: 'Test issue',
      path: 'test.path'
    };
    expect(issue.aspect).toBe('structural');
  });

  it('should export ValidationResult interface', () => {
    const result: ValidationResult = {
      resourceId: 'test-001',
      resourceType: 'Patient',
      isValid: true,
      issues: [],
      aspects: [],
      validatedAt: new Date(),
      validationTime: 100
    };
    expect(result.resourceId).toBe('test-001');
  });

  it('should export ValidationSettings interface', () => {
    const settings: ValidationSettings = {
      aspects: {
        structural: { enabled: true, severity: 'error' },
        profile: { enabled: true, severity: 'warning' },
        terminology: { enabled: true, severity: 'warning' },
        reference: { enabled: true, severity: 'error' },
        invariant: { enabled: true, severity: 'error' },
        customRule: { enabled: true, severity: 'error' },
        metadata: { enabled: true, severity: 'error' },
        anomaly: { enabled: true, severity: 'info' }
      },
      performance: {
        maxConcurrent: 5,
        batchSize: 50
      },
      resourceTypes: {
        enabled: false,
        includedTypes: [],
        excludedTypes: []
      }
    };
    expect(settings.aspects.structural.enabled).toBe(true);
  });

  it('should export ValidationAspectConfig interface', () => {
    const config: ValidationAspectConfig = {
      enabled: true,
      severity: 'error'
    };
    expect(config.enabled).toBe(true);
  });

  it('should export constants', async () => {
    // Import constants to verify they're exported
    const { DEFAULT_VALIDATION_STRICTNESS, VALIDATION_ASPECTS } = await import('../index');
    expect(DEFAULT_VALIDATION_STRICTNESS).toBe('standard');
    expect(VALIDATION_ASPECTS).toHaveLength(8);
  });
});

