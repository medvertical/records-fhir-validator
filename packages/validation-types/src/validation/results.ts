/**
 * Validation Results and Progress
 *
 * Core result, progress, and metrics types.
 * Extended analytics types (quality, confidence, completeness) live in
 * validation-advanced-metrics.ts.
 */

import type { ValidationStatus } from './enums';
import type { ValidationIssue } from './messages';

// ============================================================================
// Validation Result
// ============================================================================

/**
 * Validation result for UI display
 */
export interface ValidationResult {
  [key: string]: unknown;
  resourceId: string;
  resourceType: string;
  isValid: boolean;
  issues: ValidationIssue[];
  aspects: any[]; // AspectValidationResult from schema
  validatedAt: Date;
  validationTime: number;
  overallScore?: number;
  confidence?: number;
  fhirVersion?: 'R4' | 'R5' | 'R6';

  // Optional fields for extended result data
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
  profileUrl?: string;

  // Summary statistics
  summary?: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    informationCount: number;
    validationScore: number;
    score?: number;
    passed: boolean;
    issuesByAspect?: Record<string, number>;
    aspectBreakdown?: Record<string, any>;
  };

  // Performance metrics
  performance?: {
    totalTimeMs: number;
    aspectTimes?: Record<string, number>;
    structuralTimeMs?: number;
    profileTimeMs?: number;
    terminologyTimeMs?: number;
    referenceTimeMs?: number;
    invariantTimeMs?: number;
    customRuleTimeMs?: number;
    metadataTimeMs?: number;
  };

  // Settings and context
  settingsUsed?: any;
  settingsVersion?: number;
  context?: any;
}


/**
 * Enhanced validation summary for UI display
 */
export interface EnhancedValidationSummary {
  resourceId: string;
  resourceType: string;
  overallScore: number;
  confidence: number;
  status: 'valid' | 'warning' | 'invalid';
  aspectBreakdown: {
    structural: { score: number; confidence: number; issues: number };
    profile: { score: number; confidence: number; issues: number };
    terminology: { score: number; confidence: number; issues: number };
    reference: { score: number; confidence: number; issues: number };
    invariant: { score: number; confidence: number; issues: number };
    custom_rule: { score: number; confidence: number; issues: number };
    metadata: { score: number; confidence: number; issues: number };
  };
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  validatedAt: Date;
  validationTime: number;
}

// ============================================================================
// Validation Progress
// ============================================================================

/**
 * Validation progress with enhanced typing
 */
export interface ValidationProgress {
  jobId?: string;
  runId?: number;
  isQueued?: boolean;
  totalResources: number;
  processedResources: number;
  validResources: number; // Count of resources with no errors
  errorResources: number; // Deprecated: use resourcesWithErrors instead
  warningResources: number; // Deprecated: use resourcesWithWarnings instead
  resourcesWithErrors?: number; // Count of unique resources with at least one error
  resourcesWithWarnings?: number; // Count of unique resources with at least one warning
  currentResourceType?: string;
  startTime: Date | string;
  estimatedTimeRemaining?: number;
  isComplete: boolean;
  errors: string[];
  status: ValidationStatus;
  processingRate: number; // Resources per minute
  currentBatch?: {
    batchNumber: number;
    totalBatches: number;
    batchSize: number;
    resourcesInBatch: number;
  };
  performance?: {
    averageTimePerResource: number;
    totalTimeMs: number;
    memoryUsage?: number;
  };
  retryStatistics?: {
    totalRetryAttempts: number;
    successfulRetries: number;
    failedRetries: number;
    resourcesWithRetries: number;
    averageRetriesPerResource: number;
  };
}

/**
 * Validation run summary
 */
export interface ValidationRunSummary {
  totalResources: number;
  processedResources: number;
  validResources: number;
  errorResources: number;
  warningResources: number;
  duration: number;
  averageTimePerResource: number;
  status: ValidationStatus;
  completedAt: Date;
  errors: string[];
}

// ============================================================================
// Validation Metrics
// ============================================================================

/**
 * Validation metrics for performance tracking
 */
export interface ValidationMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  averageThroughput: number; // Resources per minute
  bestThroughput: number;
  worstThroughput: number;
  averageSuccessRate: number;
  totalResourcesProcessed: number;
  totalValidResources: number;
  totalErrorResources: number;
  lastRunDate?: Date;
}

