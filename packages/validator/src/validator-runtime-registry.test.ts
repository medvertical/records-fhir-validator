import { describe, expect, it, vi } from 'vitest';
import { ValidatorRuntimeRegistry } from './validator-runtime-registry';

describe('ValidatorRuntimeRegistry', () => {
  it('retires only matching runtimes while active leases keep isolated old state', async () => {
    const factory = vi.fn(async () => ({ answer: 'initial' }));
    const registry = new ValidatorRuntimeRegistry(factory, 10);
    const oldLease = registry.acquire('31:server:settings');
    const old = await oldLease.promise;
    const other = await registry.get('131:server:settings');
    const deployment = await registry.get();
    other.answer = 'warm peer';
    registry.retireScopes('31:');
    const current = await registry.get('31:server:settings');
    old.answer = 'late old response';
    oldLease.release();

    expect(current.answer).toBe('initial');
    expect(await registry.get('131:server:settings')).toBe(other);
    expect(other.answer).toBe('warm peer');
    expect(await registry.get()).toBe(deployment);
    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('retries a failed default initialization instead of caching its rejection', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('cold start failed'))
      .mockResolvedValueOnce({ id: 'recovered' });
    const registry = new ValidatorRuntimeRegistry(factory, 2);

    await expect(registry.get()).rejects.toThrow('cold start failed');
    await expect(registry.get()).resolves.toEqual({ id: 'recovered' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('retries a failed scoped initialization instead of poisoning the scope', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('scope failed'))
      .mockResolvedValueOnce({ id: 'recovered-scope' });
    const registry = new ValidatorRuntimeRegistry(factory, 2);

    await expect(registry.get('tenant:a')).rejects.toThrow('scope failed');
    await expect(registry.get('tenant:a')).resolves.toEqual({ id: 'recovered-scope' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not evict leased scopes until their lease is released', async () => {
    const factory = vi.fn(async () => ({ id: factory.mock.calls.length }));
    const registry = new ValidatorRuntimeRegistry(factory, 1);
    const leased = registry.acquire('tenant:leased');
    await leased.promise;
    await registry.get('tenant:other');

    expect(registry.currentScopedEntries()).toHaveLength(1);
    await expect(registry.get('tenant:leased')).resolves.toEqual({ id: 1 });
    expect(factory).toHaveBeenCalledTimes(2);
    leased.release();
    await registry.get('tenant:other');
    expect(registry.currentScopedEntries()).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
