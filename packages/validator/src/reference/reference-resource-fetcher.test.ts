import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReferenceResourceFetcher } from './reference-resource-fetcher';
import { fetchReferenceWithinDeadline, ReferenceFetchTimeoutError } from './reference-fetch-deadline';

afterEach(() => vi.useRealTimers());

describe('session reference reads', () => {
  it('shares in-flight reads and reuses successful reads only within the session', async () => {
    const patient = { resourceType: 'Patient', id: 'synthetic' };
    const client = { getResource: vi.fn(async () => patient) };
    const firstSession = createReferenceResourceFetcher(client)!;
    expect(await Promise.all([firstSession('Patient/synthetic'), firstSession('Patient/synthetic')]))
      .toEqual([patient, patient]);
    expect(await firstSession('Patient/synthetic')).toBe(patient);
    expect(client.getResource).toHaveBeenCalledTimes(1);
    await createReferenceResourceFetcher(client)!('Patient/synthetic');
    expect(client.getResource).toHaveBeenCalledTimes(2);
  });

  it('keeps another consumer alive when one deadline expires', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const getResource = vi.fn(async (_type, _id, options) => {
      signal = options.signal;
      await new Promise(resolve => setTimeout(resolve, 50));
      return { resourceType: 'Patient', id: 'synthetic' };
    });
    const fetcher = createReferenceResourceFetcher({ getResource })!;
    const start = Date.now();
    const impatient = fetchReferenceWithinDeadline(fetcher, 'Patient/synthetic', start, 10);
    const patient = fetchReferenceWithinDeadline(fetcher, 'Patient/synthetic', start, 100);
    const timeout = expect(impatient).rejects.toBeInstanceOf(ReferenceFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await timeout;
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    await expect(patient).resolves.toMatchObject({ resourceType: 'Patient' });
    expect(getResource).toHaveBeenCalledTimes(1);
  });

  it('aborts the source read when all consumers expire and permits a later retry', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const getResource = vi.fn((_type, _id, options) => new Promise((_resolve, reject) => {
      signals.push(options.signal);
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const fetcher = createReferenceResourceFetcher({ getResource })!;
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = fetchReferenceWithinDeadline(fetcher, 'Patient/synthetic', Date.now(), 10);
      const timeout = expect(pending).rejects.toBeInstanceOf(ReferenceFetchTimeoutError);
      await vi.advanceTimersByTimeAsync(10);
      await timeout;
      expect(signals[attempt].aborted).toBe(true);
    }
    expect(getResource).toHaveBeenCalledTimes(2);
  });

  it('never caches a late response from an aborted read', async () => {
    vi.useFakeTimers();
    const getResource = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return { resourceType: 'Patient', id: 'synthetic' };
    });
    const fetcher = createReferenceResourceFetcher({ getResource })!;
    const timedOut = fetchReferenceWithinDeadline(fetcher, 'Patient/synthetic', Date.now(), 10);
    const timeout = expect(timedOut).rejects.toBeInstanceOf(ReferenceFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(30);
    await timeout;
    const retry = fetcher('Patient/synthetic');
    await vi.advanceTimersByTimeAsync(30);
    await retry;
    expect(getResource).toHaveBeenCalledTimes(2);
  });

  it('does not retain failed or missing reads as successful reference evidence', async () => {
    const getResource = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(null)
      .mockResolvedValue({ resourceType: 'Patient', id: 'synthetic' });
    const fetcher = createReferenceResourceFetcher({ getResource })!;
    await expect(fetcher('Patient/synthetic')).rejects.toThrow('temporary');
    expect(await fetcher('Patient/synthetic')).toBeNull();
    expect(await fetcher('Patient/synthetic')).toMatchObject({ resourceType: 'Patient' });
    expect(getResource).toHaveBeenCalledTimes(3);
  });

  it('bounds retained payloads and reloads evicted references', async () => {
    const getResource = vi.fn(async (_type: string, id: string) => ({ resourceType: 'Patient', id }));
    const fetcher = createReferenceResourceFetcher({ getResource })!;
    for (let index = 0; index <= 5_000; index++) await fetcher(`Patient/synthetic-${index}`);
    await fetcher('Patient/synthetic-5000');
    expect(getResource).toHaveBeenCalledTimes(5_001);
    await fetcher('Patient/synthetic-0');
    expect(getResource).toHaveBeenCalledTimes(5_002);
  });

  it('does not start an already-expired read and cleans timers after synchronous failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => { throw new Error('sync failure'); });
    await expect(fetchReferenceWithinDeadline(fetcher, 'Patient/synthetic', Date.now() - 20, 10))
      .rejects.toBeInstanceOf(ReferenceFetchTimeoutError);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchReferenceWithinDeadline(fetcher, 'Patient/synthetic', Date.now(), 10))
      .rejects.toThrow('sync failure');
    expect(vi.getTimerCount()).toBe(0);
  });
});
