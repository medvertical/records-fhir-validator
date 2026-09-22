export class ReferenceFetchTimeoutError extends Error {
  constructor() {
    super('Reference fetch timed out');
    this.name = 'ReferenceFetchTimeoutError';
  }
}

export type ReferenceResourceFetcher = (
  reference: string,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export function fetchReferenceWithinDeadline(
  resourceFetcher: ReferenceResourceFetcher,
  reference: string,
  startTime: number,
  timeoutMs: number,
): Promise<unknown> {
  const remainingMs = timeoutMs - (Date.now() - startTime);
  if (remainingMs <= 0) return Promise.reject(new ReferenceFetchTimeoutError());
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const error = new ReferenceFetchTimeoutError();
      reject(error);
      controller.abort(error);
    }, remainingMs);
    Promise.resolve().then(() => resourceFetcher(reference, { signal: controller.signal })).then(
      (resource) => {
        clearTimeout(timer);
        resolve(resource);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
