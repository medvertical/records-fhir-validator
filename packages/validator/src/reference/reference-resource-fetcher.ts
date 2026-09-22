import { parseReference } from './reference-type-extractor.js';
import type { ReferenceResourceFetcher } from './reference-fetch-deadline.js';

interface SharedRead {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
  settled: boolean;
}

/** Payloads live only as long as this validation session, with a bounded cache. */
export function createReferenceResourceFetcher(client: unknown): ReferenceResourceFetcher | undefined {
  if (!client || typeof client !== 'object') return undefined;
  const getResource = (client as { getResource?: unknown }).getResource;
  if (typeof getResource !== 'function') return undefined;
  const completed = new Map<string, unknown>();
  const pending = new Map<string, SharedRead>();

  return async (reference, options) => {
    options?.signal?.throwIfAborted();
    const parsed = parseReference(reference);
    if (!parsed.isValid || !parsed.resourceType || !parsed.resourceId) return null;
    if (completed.has(reference)) {
      const resource = completed.get(reference);
      completed.delete(reference);
      completed.set(reference, resource);
      return resource;
    }
    let read = pending.get(reference);
    if (!read) {
      const controller = new AbortController();
      const created: SharedRead = {
        controller,
        consumers: 0,
        settled: false,
        promise: Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return getResource.call(client, parsed.resourceType, parsed.resourceId, { signal: controller.signal });
        }).then(resource => {
          if (!controller.signal.aborted && resource && typeof resource === 'object') {
            if (completed.size >= 5_000) completed.delete(completed.keys().next().value!);
            completed.set(reference, resource);
          }
          return resource;
        }).finally(() => {
          created.settled = true;
          if (pending.get(reference) === created) pending.delete(reference);
        }),
      };
      pending.set(reference, created);
      read = created;
    }
    return joinRead(read, options?.signal, () => {
      if (pending.get(reference) === read) pending.delete(reference);
    });
  };
}

function joinRead(read: SharedRead, signal: AbortSignal | undefined, release: () => void): Promise<unknown> {
  read.consumers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      read.consumers--;
      if (read.consumers === 0 && !read.settled) {
        release();
        read.controller.abort(signal?.reason);
      }
    };
    const abort = () => {
      finish();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    read.promise.then(resource => {
      finish();
      resolve(resource);
    }, (error: unknown) => {
      finish();
      reject(error);
    });
    if (signal?.aborted) abort();
  });
}
