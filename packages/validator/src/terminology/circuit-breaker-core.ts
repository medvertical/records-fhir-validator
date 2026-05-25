import { logger } from '../logger';
import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStats,
  CircuitState,
} from './circuit-breaker-types';

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
      resetTimeout: config?.resetTimeout ?? 60000,
      halfOpenTimeout: config?.halfOpenTimeout ?? 30000,
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

  async allowRequest(): Promise<boolean> {
    this.checkTimeouts();

    switch (this.state.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Circuit OPEN, ` +
          `rejecting request (${this.state.failureCount} failures)`
        );
        return false;

      case 'HALF_OPEN':
        logger.info(
          `[CircuitBreaker:${this.serverId}] Circuit HALF_OPEN, ` +
          `allowing test request`
        );
        return true;
    }
  }

  recordSuccess(): void {
    this.totalSuccesses++;

    switch (this.state.state) {
      case 'CLOSED':
        if (this.state.failureCount > 0) {
          logger.info(
            `[CircuitBreaker:${this.serverId}] Success, ` +
            `resetting failure count from ${this.state.failureCount}`
          );
          this.state.failureCount = 0;
        }
        break;

      case 'HALF_OPEN':
        this.state.successCount++;
        logger.info(
          `[CircuitBreaker:${this.serverId}] HALF_OPEN success ` +
          `(${this.state.successCount}/${this.config.successThreshold})`
        );

        if (this.state.successCount >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;

      case 'OPEN':
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Success while OPEN ` +
          `(unexpected state)`
        );
        break;
    }
  }

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

        if (this.state.failureCount >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;

      case 'HALF_OPEN':
        logger.warn(
          `[CircuitBreaker:${this.serverId}] HALF_OPEN test failed, ` +
          `re-opening circuit`
        );
        this.transitionToOpen();
        break;

      case 'OPEN':
        logger.warn(
          `[CircuitBreaker:${this.serverId}] Failure while OPEN ` +
          `(circuit remains open)`
        );
        break;
    }
  }

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

  reset(): void {
    logger.info(`[CircuitBreaker:${this.serverId}] Manual reset`);
    this.transitionToClosed();
  }

  getState(): CircuitState {
    this.checkTimeouts();
    return this.state.state;
  }

  isOpen(): boolean {
    return this.getState() === 'OPEN';
  }

  private checkTimeouts(): void {
    const now = Date.now();

    if (this.state.state === 'OPEN') {
      const timeSinceOpen = now - (this.state.openedAt || now);
      if (timeSinceOpen >= this.config.resetTimeout) {
        this.transitionToHalfOpen();
      }
    }
  }

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

  private calculateTimeUntilReset(now: number): number | null {
    if (this.state.state !== 'OPEN' || !this.state.openedAt) {
      return null;
    }

    const elapsed = now - this.state.openedAt;
    const remaining = this.config.resetTimeout - elapsed;

    return Math.max(0, remaining);
  }
}
