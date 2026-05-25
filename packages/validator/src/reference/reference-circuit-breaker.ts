import { logger } from '../logger';

interface CircuitState {
  failures: number;
  openedUntil: number;
}

export class ReferenceCircuitBreaker {
  private readonly circuits = new Map<string, CircuitState>();
  private readonly headUnsupported = new Set<string>();

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 30_000,
  ) {}

  isOpen(host: string): boolean {
    const state = this.circuits.get(host);
    if (!state) return false;
    if (state.openedUntil === 0) return false;
    if (Date.now() >= state.openedUntil) {
      state.failures = 0;
      state.openedUntil = 0;
      return false;
    }
    return true;
  }

  recordSuccess(host: string): void {
    const state = this.circuits.get(host);
    if (!state) return;
    state.failures = 0;
    state.openedUntil = 0;
  }

  recordFailure(host: string): void {
    const state = this.circuits.get(host) ?? { failures: 0, openedUntil: 0 };
    state.failures += 1;
    if (state.failures >= this.failureThreshold) {
      state.openedUntil = Date.now() + this.cooldownMs;
      logger.warn(
        `[BatchedReferenceChecker] Circuit opened for ${host} after ${state.failures} failures`
      );
    }
    this.circuits.set(host, state);
  }

  supportsHead(host: string | null): boolean {
    return !host || !this.headUnsupported.has(host);
  }

  markHeadUnsupported(host: string | null): void {
    if (host) {
      this.headUnsupported.add(host);
    }
  }

  reset(): void {
    this.circuits.clear();
    this.headUnsupported.clear();
  }
}
