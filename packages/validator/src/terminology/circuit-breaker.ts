/**
 * Circuit Breaker for Terminology Server Resilience
 *
 * Public facade for the circuit breaker core, manager, and shared types.
 */

export { CircuitBreaker } from './circuit-breaker-core';
export {
  CircuitBreakerManager,
  getCircuitBreakerManager,
  resetCircuitBreakerManager,
} from './circuit-breaker-manager';
export type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStats,
  CircuitState,
} from './circuit-breaker-types';
