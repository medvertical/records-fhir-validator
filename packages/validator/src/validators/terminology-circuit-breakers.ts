import { CircuitBreaker } from '../terminology/index.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';

type TerminologyOperation =
  | 'codesystem-validate-code'
  | 'subsumes'
  | 'valueset-expand'
  | 'valueset-validate-code';

export class TerminologyCircuitBreakerRegistry {
  private readonly breakers = new Map<
    TerminologyOperation,
    BoundedLruCache<string, CircuitBreaker>
  >();

  /** Return the graph-local breaker for one terminology operation and server scope. */
  get(operation: TerminologyOperation, serverScope: string): CircuitBreaker {
    let operationBreakers = this.breakers.get(operation);
    if (!operationBreakers) {
      operationBreakers = new BoundedLruCache(512);
      this.breakers.set(operation, operationBreakers);
    }
    const existing = operationBreakers.get(serverScope);
    if (existing) return existing;
    const breaker = new CircuitBreaker(`${operation}:${serverScope}`, {
      failureThreshold: 3,
      resetTimeout: 30_000,
      successThreshold: 1,
    });
    operationBreakers.set(serverScope, breaker);
    return breaker;
  }
}
