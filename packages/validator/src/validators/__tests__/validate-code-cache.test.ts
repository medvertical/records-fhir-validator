/**
 * Tests for the TerminologyApiClient $validate-code result cache (P-4).
 *
 * Covers cache exports only — the caching behaviour on real HTTP calls is
 * exercised indirectly by the integration tests that go through
 * `TerminologyApiClient.validateCode`. Here we lock the module-level
 * cache contract: size tracking + clear + TTL/LRU eviction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearValidateCodeCache,
  getValidateCodeCacheSize,
} from '../terminology-api-client';

describe('validate-code cache', () => {
  beforeEach(() => {
    clearValidateCodeCache();
  });

  it('is empty after clear', () => {
    expect(getValidateCodeCacheSize()).toBe(0);
  });

  it('tracks entries as the real validateCode flow writes them', async () => {
    // Exercise the cache indirectly via validateCode. We mock axios so the
    // "HTTP call" returns a deterministic Parameters result; each unique
    // (system, code, valueSet) tuple adds one entry.
    vi.resetModules();
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: {
          ...actual.default,
          get: vi.fn().mockResolvedValue({
            data: {
              resourceType: 'Parameters',
              parameter: [{ name: 'result', valueBoolean: true }],
            },
          }),
        },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient, clearValidateCodeCache: clear, getValidateCodeCacheSize: size } =
      await import('../terminology-api-client');

    clear();
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    });

    const a = await client.validateCode('A', 'http://x.sys', 'http://vs/1');
    expect(a).toBe(true);
    expect(size()).toBe(1);

    // Same tuple — hits the cache, no new entry.
    const a2 = await client.validateCode('A', 'http://x.sys', 'http://vs/1');
    expect(a2).toBe(true);
    expect(size()).toBe(1);

    // Different code — new entry.
    await client.validateCode('B', 'http://x.sys', 'http://vs/1');
    expect(size()).toBe(2);

    // Different valueSet — new entry.
    await client.validateCode('A', 'http://x.sys', 'http://vs/2');
    expect(size()).toBe(3);

    // Clear drops everything.
    clear();
    expect(size()).toBe(0);

    vi.doUnmock('axios');
  });

  it('passes mTLS credentials through the terminology request agent', async () => {
    vi.resetModules();
    const get = vi.fn().mockResolvedValue({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: true }],
      },
    });

    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: {
          ...actual.default,
          get,
        },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient } = await import('../terminology-api-client');
    const client = new TerminologyApiClient({
      serverUrl: 'https://ontoserver.example/fhir',
      strategy: 'server-first',
      auth: {
        type: 'mtls',
        clientCert: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
        clientKey: 'test-client-key-material',
        caCert: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
        rejectUnauthorized: false,
      },
    });

    await client.validateCode('A', 'http://loinc.org', 'http://vs/1');

    const requestConfig = get.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
      httpsAgent: { options: Record<string, unknown> };
    };
    expect(requestConfig.headers.Authorization).toBeUndefined();
    expect(requestConfig.headers.Accept).toBe('application/fhir+json');
    expect(requestConfig.httpsAgent.options.cert).toContain('cert');
    expect(requestConfig.httpsAgent.options.key).toContain('key');
    expect(requestConfig.httpsAgent.options.ca).toContain('ca');
    expect(requestConfig.httpsAgent.options.rejectUnauthorized).toBe(false);

    vi.doUnmock('axios');
  });

  it('fails open for direct CodeSystem validation when no terminology server is configured', async () => {
    vi.resetModules();
    const get = vi.fn();

    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: {
          ...actual.default,
          get,
        },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient } = await import('../terminology-api-client');
    const client = new TerminologyApiClient({
      strategy: 'local-first',
    });

    const result = await client.validateCodeInCodeSystem(
      '77606-2',
      'http://loinc.org',
      'Weight-for-length Per age and sex',
    );

    expect(result).toEqual({ valid: true });
    expect(get).not.toHaveBeenCalled();

    vi.doUnmock('axios');
  });

  it('is cleared by ValueSetValidator.clearCache for settings and tx-server changes', async () => {
    vi.resetModules();
    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: {
          ...actual.default,
          get: vi.fn().mockResolvedValue({
            data: {
              resourceType: 'Parameters',
              parameter: [{ name: 'result', valueBoolean: true }],
            },
          }),
        },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient, getValidateCodeCacheSize: size } =
      await import('../terminology-api-client');
    const { ValueSetValidator } = await import('../valueset-validator');
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    });

    await client.validateCode('A', 'http://x.sys', 'http://vs/1');
    expect(size()).toBe(1);

    const validator = new ValueSetValidator();
    expect(validator.getCacheStats().validateCodeResultCount).toBe(1);

    validator.clearCache();

    expect(size()).toBe(0);
    expect(validator.getCacheStats().validateCodeResultCount).toBe(0);

    vi.doUnmock('axios');
  });
});
