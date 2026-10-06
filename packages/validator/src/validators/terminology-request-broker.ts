import { AsyncResource } from 'node:async_hooks';
export type TerminologyRemoteOperation =
  | 'codesystem-subsumes'
  | 'codesystem-validate-code'
  | 'valueset-expand'
  | 'valueset-validate-code';

export interface TerminologyBrokerObservation {
  operation: TerminologyRemoteOperation;
  queueDepth: number;
  queueWaitMs: number;
}

export type TerminologyBrokerObserver = (
  observation: TerminologyBrokerObservation,
) => void;

interface PendingRequest<T> {
  enqueuedAt: number;
  operation: TerminologyRemoteOperation;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface ServerQueue {
  active: number;
  maxConcurrency: number;
  pending: Array<PendingRequest<unknown>>;
}

let activeObserver: TerminologyBrokerObserver | undefined;

/**
 * Install an embedder-owned observer without coupling the validator package to
 * a particular metrics SDK. Later calls replace the previous observer.
 */
export function setTerminologyBrokerObserver(
  observer: TerminologyBrokerObserver | undefined,
): void {
  activeObserver = observer;
}

/**
 * Process-wide, per-server concurrency boundary for remote terminology I/O.
 * The interface deliberately stays small: callers submit work, while queueing,
 * fairness and metrics remain local to this deep module.
 */
export class TerminologyRequestBroker {
  private readonly queues = new Map<string, ServerQueue>();

  async run<T>(
    serverScope: string,
    operation: TerminologyRemoteOperation,
    maxConcurrency: number,
    task: () => Promise<T>,
  ): Promise<T> {
    const queue = this.getQueue(serverScope, maxConcurrency);
    return new Promise<T>((resolve, reject) => {
      const request: PendingRequest<T> = {
        enqueuedAt: Date.now(),
        operation,
        run: AsyncResource.bind(task),
        resolve,
        reject,
      };
      queue.pending.push(request as PendingRequest<unknown>);
      this.drain(serverScope, queue);
    });
  }

  getStats(serverScope: string): { active: number; queued: number } {
    const queue = this.queues.get(serverScope);
    return queue
      ? { active: queue.active, queued: queue.pending.length }
      : { active: 0, queued: 0 };
  }

  private getQueue(serverScope: string, maxConcurrency: number): ServerQueue {
    const normalizedMax = Math.max(1, Math.min(64, Math.floor(maxConcurrency)));
    const existing = this.queues.get(serverScope);
    if (existing) {
      existing.maxConcurrency = normalizedMax;
      return existing;
    }
    const queue: ServerQueue = {
      active: 0,
      maxConcurrency: normalizedMax,
      pending: [],
    };
    this.queues.set(serverScope, queue);
    return queue;
  }

  private drain(serverScope: string, queue: ServerQueue): void {
    while (queue.active < queue.maxConcurrency && queue.pending.length > 0) {
      const request = queue.pending.shift();
      if (!request) break;
      queue.active++;
      this.observe({
        operation: request.operation,
        queueDepth: queue.pending.length,
        queueWaitMs: Date.now() - request.enqueuedAt,
      });
      void request.run().then(request.resolve, request.reject).finally(() => {
        queue.active--;
        this.drain(serverScope, queue);
        if (queue.active === 0 && queue.pending.length === 0) {
          this.queues.delete(serverScope);
        }
      });
    }
  }

  private observe(observation: TerminologyBrokerObservation): void {
    try {
      activeObserver?.(observation);
    } catch {
      // Metrics must never alter validation behavior.
    }
  }
}

export const sharedTerminologyRequestBroker = new TerminologyRequestBroker();
