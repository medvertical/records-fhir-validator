import { logger } from '../logger.js';
import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStats,
  CircuitState,
} from './circuit-breaker-types.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';

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
        logger.warn('[CircuitBreaker] Circuit open; rejecting request', {
          ...sensitiveValueMetadata(this.serverId),
          failureCount: this.state.failureCount,
        });
        return false;

      case 'HALF_OPEN':
        logger.info(
          '[CircuitBreaker] Circuit half-open; allowing test request',
          sensitiveValueMetadata(this.serverId),
        );
        return true;
    }
  }

  recordSuccess(): void {
    this.totalSuccesses++;

    switch (this.state.state) {
      case 'CLOSED':
        if (this.state.failureCount > 0) {
          logger.info('[CircuitBreaker] Success; resetting failure count', {
            ...sensitiveValueMetadata(this.serverId),
            failureCount: this.state.failureCount,
          });
          this.state.failureCount = 0;
        }
        break;

      case 'HALF_OPEN':
        this.state.successCount++;
        logger.info('[CircuitBreaker] Half-open request succeeded', {
          ...sensitiveValueMetadata(this.serverId),
          successCount: this.state.successCount,
          successThreshold: this.config.successThreshold,
        });

        if (this.state.successCount >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;

      case 'OPEN':
        logger.warn(
          '[CircuitBreaker] Success recorded while circuit open',
          sensitiveValueMetadata(this.serverId),
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
        logger.warn('[CircuitBreaker] Failure recorded', {
          ...sensitiveValueMetadata(this.serverId),
          failureCount: this.state.failureCount,
          failureThreshold: this.config.failureThreshold,
        });

        if (this.state.failureCount >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;

      case 'HALF_OPEN':
        logger.warn(
          '[CircuitBreaker] Half-open test failed; reopening circuit',
          sensitiveValueMetadata(this.serverId),
        );
        this.transitionToOpen();
        break;

      case 'OPEN':
        logger.warn(
          '[CircuitBreaker] Failure recorded while circuit remains open',
          sensitiveValueMetadata(this.serverId),
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
    logger.info('[CircuitBreaker] Manual reset', sensitiveValueMetadata(this.serverId));
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
    logger.info('[CircuitBreaker] Transitioning to closed', {
      ...sensitiveValueMetadata(this.serverId),
      totalSuccesses: this.totalSuccesses,
    });

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
    logger.warn('[CircuitBreaker] Transitioning to open', {
      ...sensitiveValueMetadata(this.serverId),
      failureCount: this.state.failureCount,
    });

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
      '[CircuitBreaker] Transitioning to half-open',
      sensitiveValueMetadata(this.serverId),
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
