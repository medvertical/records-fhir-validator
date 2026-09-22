import { logger } from '../logger.js';
import type { CircuitBreaker } from '../terminology/index.js';
import type { TerminologyResolutionConfig } from './valueset-types.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';

export const DEFAULT_VALUESET_EXPAND_TIMEOUT_MS = 10000;
export const DEFAULT_REMOTE_TERMINOLOGY_TIMEOUT_MS = 5000;

const DEFAULT_SLOW_RESPONSE_THRESHOLD_MS = 2500;
// Concurrency, request timeouts and the circuit breaker bound remote load.
// A lifetime quota silently stops checking every later resource in a warm runtime.
const DEFAULT_MAX_REMOTE_CODE_SYSTEM_VALIDATIONS = Number.POSITIVE_INFINITY;

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveEnvNumber(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env[name] : undefined;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getRemoteTerminologyTimeoutMs(
  config: TerminologyResolutionConfig,
  fallback: number,
): number {
  return positiveNumber(
    config.serverDelegation?.requestTimeoutMs,
    positiveEnvNumber('VALIDATION_TERMINOLOGY_REQUEST_TIMEOUT_MS', fallback),
  );
}

function getSlowResponseThresholdMs(config: TerminologyResolutionConfig): number {
  return positiveNumber(
    config.serverDelegation?.slowResponseThresholdMs,
    positiveEnvNumber('VALIDATION_TERMINOLOGY_SLOW_RESPONSE_MS', DEFAULT_SLOW_RESPONSE_THRESHOLD_MS),
  );
}

export function getMaxRemoteCodeSystemValidations(config: TerminologyResolutionConfig): number {
  return positiveNumber(
    config.serverDelegation?.maxRemoteCodeSystemValidations,
    positiveEnvNumber(
      'VALIDATION_MAX_REMOTE_CODE_SYSTEM_VALIDATIONS',
      DEFAULT_MAX_REMOTE_CODE_SYSTEM_VALIDATIONS,
    ),
  );
}

export function getMaxConcurrentRemoteTerminologyRequests(
  config: TerminologyResolutionConfig,
): number {
  const configured = Number(
    config.serverDelegation?.maxConcurrentRequests
      ?? process.env.RECORDS_VALIDATOR_TERMINOLOGY_CONCURRENCY
      ?? 8,
  );
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(64, Math.floor(configured)))
    : 8;
}

export function recordTerminologyResponse(
  circuitBreaker: CircuitBreaker,
  config: TerminologyResolutionConfig,
  operation: string,
  serverUrl: string,
  startedAt: number,
): void {
  const durationMs = Date.now() - startedAt;
  const slowThresholdMs = getSlowResponseThresholdMs(config);
  if (slowThresholdMs > 0 && durationMs >= slowThresholdMs) {
    logger.warn('[TerminologyApiClient] Slow terminology response; recording circuit failure', {
      ...terminologyTargetMetadata(serverUrl),
      operation,
      durationMs,
      slowThresholdMs,
    });
    circuitBreaker.recordFailure();
    return;
  }

  circuitBreaker.recordSuccess();
}
