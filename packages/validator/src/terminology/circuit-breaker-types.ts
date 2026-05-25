export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Time in ms before attempting recovery (moving to HALF_OPEN) */
  resetTimeout: number;

  /** Time in ms in HALF_OPEN before trying full recovery */
  halfOpenTimeout: number;

  /** Number of successful requests in HALF_OPEN to close circuit */
  successThreshold: number;
}

export interface CircuitBreakerState {
  /** Current circuit state */
  state: CircuitState;

  /** Number of consecutive failures */
  failureCount: number;

  /** Number of consecutive successes (in HALF_OPEN) */
  successCount: number;

  /** Timestamp when circuit was opened */
  openedAt: number | null;

  /** Timestamp of last state change */
  lastStateChange: number;

  /** Timestamp of last failure */
  lastFailure: number | null;
}

export interface CircuitBreakerStats {
  /** Server identifier */
  serverId: string;

  /** Current state */
  state: CircuitState;

  /** Total failures recorded */
  totalFailures: number;

  /** Total successes recorded */
  totalSuccesses: number;

  /** Time since circuit opened (ms) */
  timeSinceOpen: number | null;

  /** Time until next recovery attempt (ms) */
  timeUntilReset: number | null;
}
