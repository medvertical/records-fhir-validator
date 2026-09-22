/**
 * Versioned, transport-safe read model for validation-run activity.
 *
 * This contract intentionally distinguishes issue occurrences from affected
 * resources. Consumers must not infer one from the other.
 */

export type ValidationRunLifecycleStatus =
  | 'idle'
  | 'queued'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'interrupted'
  | 'stopped'
  | 'completed'
  | 'failed';

export type ValidationRunOutcome =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'no-data'
  | 'cancelled'
  | 'error'
  | null;

export type ValidationRunTerminationCause =
  | 'user-stop'
  | 'resource-pressure'
  | 'shutdown'
  | 'lease-loss'
  | 'timeout'
  | 'runtime-cleanup';

export interface ValidationRunResourceTypeSnapshot {
  processed: number;
  total: number;
  issueOccurrences: {
    error: number;
    warning: number;
    information: number;
  };
  affectedResources: {
    error: number;
    warning: number;
  };
}

export interface ValidationRunInFlightResourceTypeSnapshot {
  processed: number;
  total: number;
  pending: number;
  phase: 'validating' | 'persisting';
  startedAt: string | null;
  updatedAt: string | null;
}

export interface ValidationRunActivityEventSnapshot {
  timestamp: string;
  id?: string;
  phase?: 'initialization' | 'planning' | 'progress' | 'prewarm' | 'processing' | 'finalization';
  lifecycleStatus?: ValidationRunLifecycleStatus;
  operation?: {
    reason: 'timeout' | 'connection' | 'http' | 'invalid_response' | 'unknown';
    page: number;
    pageSize?: number;
    retry?: number;
    maxRetries?: number;
    httpStatus?: number;
  };
  stats?: {
    processed?: number;
    total?: number;
    validPercent?: number;
    errors?: number;
    warnings?: number;
    inFlight?: number;
    embeddedProcessed?: number;
    newErrors?: number;
    newWarnings?: number;
    durationSeconds?: number;
    idleSeconds?: number;
  };
  resourceType?: string;
  resourceId?: string;
  status?: 'valid' | 'warning' | 'error';
  issueCount?: number;
  type?: 'resource_type_started' | 'resource_type_completed' | 'resource_type_incomplete'
    | 'first_error' | 'first_warning' | 'milestone' | 'phase_changed' | 'lifecycle_changed'
    | 'source_retry' | 'source_error' | 'progress_updated' | 'findings_updated'
    | 'validation_delayed' | 'validation_progress_resumed' | 'run_resumed';
  message?: string;
}

export interface ValidationRunSnapshotV1 {
  schemaVersion: 1;
  runId: number | null;
  jobId: string | null;
  serverId: number | null;
  lifecycle: {
    status: ValidationRunLifecycleStatus;
    active: boolean;
    terminal: boolean;
    canPause: boolean;
    stoppedByUser: boolean;
    /** Optional only for snapshots produced before this V1 field was introduced. */
    terminationCause?: ValidationRunTerminationCause | null;
    interruptedReason: string | null;
  };
  outcome: ValidationRunOutcome;
  progress: {
    processedResources: number;
    /** Includes validated resources in the current uncommitted page. */
    liveProcessedResources?: number;
    /** Validated resources still awaiting their page commit. */
    inFlightProcessedResources?: number;
    totalResources: number;
    validResources: number;
    validationUnits: {
      processed: number;
      total: number;
      embeddedProcessed: number;
      embeddedTotal: number;
      embeddedByType: Record<string, number>;
    };
    percentage: number;
    ratePerSecond: number;
    estimatedSecondsRemaining: number;
  };
  issues: {
    /**
     * Persisted, user-visible issue rows. These counts match the issue
     * workspace and may be higher than the counters used by the quality gate.
     */
    occurrences: {
      error: number;
      warning: number;
      information: number;
    };
    /**
     * Effective counters used by quality-gate evaluation after operational
     * issue filtering. Optional only for wire compatibility with early V1
     * snapshots; current producers always publish it.
     */
    qualityGateOccurrences?: {
      error: number;
      warning: number;
      information: number;
    };
    affectedResources: {
      error: number;
      warning: number;
    };
  };
  activity: {
    currentResourceType: string | null;
    activeResourceTypes: string[];
    nextResourceType: string | null;
    message: string | null;
    events: ValidationRunActivityEventSnapshot[];
    inFlightResourceTypes?: Record<string, ValidationRunInFlightResourceTypeSnapshot>;
  };
  queue: {
    length: number;
    currentRunId: number | null;
    processing: boolean;
  };
  resourceTypes: Record<string, ValidationRunResourceTypeSnapshot>;
  timestamps: {
    startedAt: string | null;
    completedAt: string | null;
    lastActivityAt: string | null;
  };
  integrity: {
    status: 'ok' | 'incomplete' | 'corrupt';
    reasons: string[];
  } | null;
  failure: {
    code: string | null;
    message: string | null;
  } | null;
}
