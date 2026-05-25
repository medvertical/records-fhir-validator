import { CircuitBreaker } from './circuit-breaker-core';
import type { CircuitBreakerConfig, CircuitBreakerStats } from './circuit-breaker-types';

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

  getBreaker(serverId: string): CircuitBreaker {
    if (!this.breakers.has(serverId)) {
      this.breakers.set(serverId, new CircuitBreaker(serverId, this.defaultConfig));
    }
    return this.breakers.get(serverId)!;
  }

  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map(breaker => breaker.getStats());
  }

  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }
}

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
