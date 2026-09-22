import { CircuitBreaker } from './circuit-breaker-core.js';
import type { CircuitBreakerConfig, CircuitBreakerStats } from './circuit-breaker-types.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';

export class CircuitBreakerManager {
  private readonly breakers: BoundedLruCache<string, CircuitBreaker>;
  private defaultConfig: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>, maxServers: number = 512) {
    this.breakers = new BoundedLruCache(maxServers);
    this.defaultConfig = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeout: config?.resetTimeout ?? 60000,
      halfOpenTimeout: config?.halfOpenTimeout ?? 30000,
      successThreshold: config?.successThreshold ?? 2,
    };
  }

  getBreaker(serverId: string): CircuitBreaker {
    const existing = this.breakers.get(serverId);
    if (existing) return existing;
    const breaker = new CircuitBreaker(serverId, this.defaultConfig);
    this.breakers.set(serverId, breaker);
    return breaker;
  }

  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.keys())
      .map(key => this.breakers.get(key))
      .filter((breaker): breaker is CircuitBreaker => breaker !== undefined)
      .map(breaker => breaker.getStats());
  }

  resetAll(): void {
    for (const key of Array.from(this.breakers.keys())) this.breakers.get(key)?.reset();
  }
}

export function getCircuitBreakerManager(config?: Partial<CircuitBreakerConfig>): CircuitBreakerManager {
  return new CircuitBreakerManager(config);
}

export function resetCircuitBreakerManager(): void {
  // Compatibility no-op: manager instances are caller-owned.
}
