/**
 * Circuit Breaker for Terminology Server Resilience
 * 
 * Implements circuit breaker pattern to protect against failing terminology servers.
 * Tracks failures, opens circuit after threshold, and attempts recovery.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail fast without hitting server
 * - HALF_OPEN: Testing recovery, limited requests allowed
 * 
 * Responsibilities: Failure tracking and circuit state management ONLY
 * - Does not perform HTTP operations (handled by DirectTerminologyClient)
 * - Does not manage server selection (handled by TerminologyServerRouter)
 * 
 * File size: ~250 lines (adhering to global.mdc standards)
 */

// ============================================================================
// Types
// ============================================================================

import { logger } from '../logger';

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

// ============================================================================
// Circuit Breaker
// ============================================================================

export class CircuitBreaker {
  private readonly serverId: string;
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;

  constructor(serverId: string, config?: Partial<CircuitBreakerConfig>) {
    this.serverId = serverId;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeout: config?.resetTimeout ?? 60000, // 1 minute
      halfOpenTimeout: config?.halfOpenTimeout ?? 30000, // 30 seconds
      successThreshold: config?.successThreshold ?? 2,
    };
    
    this.state = {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      openedAt: null,
      lastStateChange: Date.now(),
      lastFailure: null,
    };
  }

  /**
   * Check if request is allowed through the circuit
   * 
   * @returns true if request should proceed, false if circuit is open
   */
  async allowRequest(): Promise<boolean> {
    // Update state if timeouts have elapsed
    this.checkTimeouts();
    
    switch (this.state.state) {
      case 'CLOSED':
        // Normal operation
        return true;
      
      case 'OPEN':
        // Circuit is open, fail fast
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Circuit OPEN, ` +
          `rejecting request (${this.state.failureCount} failures)`
        );
        return false;
      
      case 'HALF_OPEN':
        // Allow limited requests to test recovery
        logger.info(
          `[CircuitBreaker:${this.serverId}] Circuit HALF_OPEN, ` +
          `allowing test request`
        );
        return true;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.totalSuccesses++;
    
    switch (this.state.state) {
      case 'CLOSED':
        // Reset failure count on success
        if (this.state.failureCount > 0) {
          logger.info(
            `[CircuitBreaker:${this.serverId}] Success, ` +
            `resetting failure count from ${this.state.failureCount}`
          );
          this.state.failureCount = 0;
        }
        break;
      
      case 'HALF_OPEN':
        // Count successes toward recovery
        this.state.successCount++;
        logger.info(
          `[CircuitBreaker:${this.serverId}] HALF_OPEN success ` +
          `(${this.state.successCount}/${this.config.successThreshold})`
        );
        
        // Close circuit if threshold reached
        if (this.state.successCount >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;
      
      case 'OPEN':
        // Shouldn't happen (requests blocked), but handle gracefully
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Success while OPEN ` +
          `(unexpected state)`
        );
        break;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.totalFailures++;
    this.state.lastFailure = Date.now();
    
    switch (this.state.state) {
      case 'CLOSED':
        this.state.failureCount++;
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Failure ` +
          `(${this.state.failureCount}/${this.config.failureThreshold})`
        );
        
        // Open circuit if threshold reached
        if (this.state.failureCount >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;
      
      case 'HALF_OPEN':
        // Failure during recovery, re-open circuit
        logger.warn(
          `[CircuitBreaker:${this.serverId}] HALF_OPEN test failed, ` +
          `re-opening circuit`
        );
        this.transitionToOpen();
        break;
      
      case 'OPEN':
        // Already open, just log
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Failure while OPEN ` +
          `(circuit remains open)`
        );
        break;
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    const now = Date.now();
    
    return {
      serverId: this.serverId,
      state: this.state.state,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      timeSinceOpen: this.state.openedAt ? now - this.state.openedAt : null,
      timeUntilReset: this.calculateTimeUntilReset(now),
    };
  }

  /**
   * Manually reset the circuit breaker (for admin intervention)
   */
  reset(): void {
    logger.info(`[CircuitBreaker:${this.serverId}] Manual reset`);
    this.transitionToClosed();
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    this.checkTimeouts();
    return this.state.state;
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.getState() === 'OPEN';
  }

  // --------------------------------------------------------------------------
  // Private Helper Methods
  // --------------------------------------------------------------------------

  /**
   * Check if timeouts have elapsed and update state accordingly
   */
  private checkTimeouts(): void {
    const now = Date.now();
    
    if (this.state.state === 'OPEN') {
      // Check if reset timeout has elapsed
      const timeSinceOpen = now - (this.state.openedAt || now);
      if (timeSinceOpen >= this.config.resetTimeout) {
        this.transitionToHalfOpen();
      }
    }
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    logger.info(
      `[CircuitBreaker:${this.serverId}] Transitioning to CLOSED ` +
      `(${this.totalSuccesses} total successes)`
    );
    
    this.state = {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      openedAt: null,
      lastStateChange: Date.now(),
      lastFailure: this.state.lastFailure,
    };
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    logger.warn(
      `[CircuitBreaker:${this.serverId}] Transitioning to OPEN ` +
      `(${this.state.failureCount} consecutive failures)`
    );
    
    this.state = {
      state: 'OPEN',
      failureCount: this.state.failureCount,
      successCount: 0,
      openedAt: Date.now(),
      lastStateChange: Date.now(),
      lastFailure: this.state.lastFailure,
    };
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    logger.info(
      `[CircuitBreaker:${this.serverId}] Transitioning to HALF_OPEN ` +
      `(testing recovery)`
    );
    
    this.state = {
      state: 'HALF_OPEN',
      failureCount: 0,
      successCount: 0,
      openedAt: this.state.openedAt,
      lastStateChange: Date.now(),
      lastFailure: this.state.lastFailure,
    };
  }

  /**
   * Calculate time until next reset attempt
   */
  private calculateTimeUntilReset(now: number): number | null {
    if (this.state.state !== 'OPEN' || !this.state.openedAt) {
      return null;
    }
    
    const elapsed = now - this.state.openedAt;
    const remaining = this.config.resetTimeout - elapsed;
    
    return Math.max(0, remaining);
  }
}

// ============================================================================
// Circuit Breaker Manager
// ============================================================================

export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.defaultConfig = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeout: config?.resetTimeout ?? 60000,
      halfOpenTimeout: config?.halfOpenTimeout ?? 30000,
      successThreshold: config?.successThreshold ?? 2,
    };
  }

  /**
   * Get or create circuit breaker for a server
   */
  getBreaker(serverId: string): CircuitBreaker {
    if (!this.breakers.has(serverId)) {
      this.breakers.set(serverId, new CircuitBreaker(serverId, this.defaultConfig));
    }
    return this.breakers.get(serverId)!;
  }

  /**
   * Get statistics for all circuit breakers
   */
  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map(breaker => breaker.getStats());
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let managerInstance: CircuitBreakerManager | null = null;

export function getCircuitBreakerManager(config?: Partial<CircuitBreakerConfig>): CircuitBreakerManager {
  if (!managerInstance) {
    managerInstance = new CircuitBreakerManager(config);
  }
  return managerInstance;
}

export function resetCircuitBreakerManager(): void {
  managerInstance = null;
}
