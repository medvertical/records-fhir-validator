/**
 * Business Rule Types
 * 
 * Shared types for business rule validation.
 * Extracted from business-rule-validator.ts to comply with global.mdc guidelines.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';

// ============================================================================
// Business Rule Definition
// ============================================================================

export interface BusinessRule {
  name: string;
  description: string;
  validator: (resource: any, resourceType: string) => Promise<ValidationIssue[]>;
}

export type BusinessRuleMap = Map<string, BusinessRule[]>;

// ============================================================================
// Performance Metrics
// ============================================================================

export interface RulePerformanceMetrics {
  ruleId: string;
  ruleName: string;
  executionCount: number;
  totalExecutionTimeMs: number;
  averageExecutionTimeMs: number;
  minExecutionTimeMs: number;
  maxExecutionTimeMs: number;
  failureCount: number;
  errorCount: number;
  lastExecutedAt: Date;
}

// ============================================================================
// Custom Rules (from DB)
// ============================================================================

export interface CustomBusinessRule {
  id: number;
  ruleId: string;
  name: string;
  description?: string;
  expression: string; // FHIRPath expression
  severity: 'error' | 'warning' | 'info';
  resourceTypes: string[];
  fhirVersions: string[];
  enabled: boolean;
  validationMessage?: string;
  suggestions?: string[];
}

// ============================================================================
// Rule Execution Result
// ============================================================================

export interface RuleExecutionResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  executionTimeMs: number;
  issues: ValidationIssue[];
  error?: string;
}

