/**
 * Tests for the TerminologyApiClient $validate-code result cache (P-4).
 *
 * Covers owned cache state — the caching behaviour on real HTTP calls is
 * exercised indirectly by the integration tests that go through
 * `TerminologyApiClient.validateCode`. Here we lock the module-level
 * cache contract: size tracking + clear + TTL/LRU eviction.
 */
import { describe, it, expect, vi } from 'vitest';
import { TerminologyOperationCache } from '../terminology-operation-cache';
import { ValueSetCache } from '../valueset-cache';

describe('validate-code cache', () => {
  it('is empty after clear', () => {
    const operationCache = new TerminologyOperationCache();
    operationCache.storeValidateCode('test', true);
    operationCache.clearValidateCode();
    expect(operationCache.getStats().validateCodeResultCount).toBe(0);
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

    const { TerminologyApiClient } =
      await import('../terminology-api-client');

    const operationCache = new TerminologyOperationCache();
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    }, new ValueSetCache(), operationCache);
    const size = () => operationCache.getStats().validateCodeResultCount;

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
    operationCache.clearValidateCode();
    expect(size()).toBe(0);

    vi.doUnmock('axios');
  });

  it('distinguishes an authoritative negative response from an unavailable check', async () => {
    vi.resetModules();
    const get = vi.fn()
      .mockResolvedValueOnce({
        data: {
          resourceType: 'Parameters',
          parameter: [{ name: 'result', valueBoolean: false }],
        },
      })
      .mockRejectedValueOnce(new Error('terminology server unavailable'));

    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient } = await import('../terminology-api-client');
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    });

    await expect(client.validateCodeOutcome(
      'outside-required-set',
      'http://x.sys',
      'http://vs/required',
      'required',
    )).resolves.toBe('invalid');
    await expect(client.validateCodeOutcome(
      'not-checked',
      'http://x.sys',
      'http://vs/unavailable',
      'required',
    )).resolves.toBe('unverified');

    vi.doUnmock('axios');
  });

  it('coalesces concurrent validate-code requests for the same tuple', async () => {
    vi.resetModules();
    let resolveGet: ((value: unknown) => void) | undefined;
    const get = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveGet = resolve;
    }));

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

    const { TerminologyApiClient } =
      await import('../terminology-api-client');

    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    });

    const first = client.validateCode('A', 'http://x.sys', 'http://vs/1');
    const second = client.validateCode('A', 'http://x.sys', 'http://vs/1');
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    resolveGet?.({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: true }],
      },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(get).toHaveBeenCalledTimes(1);

    vi.doUnmock('axios');
  });

  it('scopes unresolvable ValueSet results to the requested system version', async () => {
    vi.resetModules();
    const notResolvable = {
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'not-found',
            details: { text: 'ValueSet could not be resolved' },
          }],
        },
      },
    };
    const get = vi.fn()
      .mockRejectedValueOnce(notResolvable)
      .mockResolvedValue({
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

    const { TerminologyApiClient } =
      await import('../terminology-api-client');

    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    });

    const valueSetUrl = 'http://vs/not-resolvable';
    const system = 'http://x.sys';
    expect(await client.validateCode(
      'A', system, valueSetUrl, 'required', undefined, 'edition-1',
    )).toBe(true);
    expect(await client.validateCode(
      'B', system, valueSetUrl, 'required', undefined, 'edition-1',
    )).toBe(true);
    expect(client.isValueSetNotResolvable(
      valueSetUrl, undefined, system, 'edition-1',
    )).toBe(true);

    expect(await client.validateCode(
      'C', system, valueSetUrl, 'required', undefined, 'edition-2',
    )).toBe(true);
    expect(await client.validateCode(
      'D', system, valueSetUrl, 'required',
    )).toBe(true);
    expect(await client.validateCode(
      'E', 'http://y.sys', valueSetUrl, 'required', undefined, 'edition-1',
    )).toBe(true);

    expect(client.isValueSetNotResolvable(
      valueSetUrl, undefined, system, 'edition-2',
    )).toBe(false);
    expect(get).toHaveBeenCalledTimes(4);

    vi.doUnmock('axios');
  });

  it('isolates required and fail-open binding results in the validate-code cache', async () => {
    vi.resetModules();
    const get = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'code-invalid',
            details: { text: 'Unknown code' },
          }],
        },
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

    const { TerminologyApiClient } =
      await import('../terminology-api-client');
    const operationCache = new TerminologyOperationCache();
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    }, new ValueSetCache(), operationCache);

    expect(await client.validateCode(
      'A',
      'http://x.sys',
      'http://vs/strength-order-a',
      'extensible',
    )).toBe(true);
    expect(await client.validateCode(
      'A',
      'http://x.sys',
      'http://vs/strength-order-a',
      'required',
    )).toBe(false);

    operationCache.clearValidateCode();

    expect(await client.validateCode(
      'B',
      'http://x.sys',
      'http://vs/strength-order-b',
      'required',
    )).toBe(false);
    expect(await client.validateCode(
      'B',
      'http://x.sys',
      'http://vs/strength-order-b',
      'preferred',
    )).toBe(true);

    expect(get).toHaveBeenCalledTimes(4);

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

  it('opens the ValueSet validate-code circuit after transient failures', async () => {
    vi.resetModules();
    const get = vi.fn().mockRejectedValue(new Error('timeout of 5000ms exceeded'));

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
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    });

    expect(await client.validateCode('A', 'http://x.sys', 'http://vs/1')).toBe(false);
    expect(await client.validateCode('B', 'http://x.sys', 'http://vs/1')).toBe(false);
    expect(await client.validateCode('C', 'http://x.sys', 'http://vs/1')).toBe(false);
    expect(get).toHaveBeenCalledTimes(3);

    expect(await client.validateCode('D', 'http://x.sys', 'http://vs/1')).toBe(false);
    expect(get).toHaveBeenCalledTimes(3);

    vi.doUnmock('axios');
  });

  it('opens the ValueSet validate-code circuit after slow successful responses', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const get = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(5);
      return {
        data: {
          resourceType: 'Parameters',
          parameter: [{ name: 'result', valueBoolean: true }],
        },
      };
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

    try {
      const { TerminologyApiClient } = await import('../terminology-api-client');
      const client = new TerminologyApiClient({
        serverUrl: 'https://slow-tx.example.com/r4',
        strategy: 'server-first',
        serverDelegation: {
          expandValueSets: true,
          validateCodes: true,
          cacheResults: true,
          cacheTTLSeconds: 3600,
          slowResponseThresholdMs: 1,
        },
      });

      expect(await client.validateCode('A', 'http://x.sys', 'http://vs/1')).toBe(true);
      expect(await client.validateCode('B', 'http://x.sys', 'http://vs/1')).toBe(true);
      expect(await client.validateCode('C', 'http://x.sys', 'http://vs/1')).toBe(true);
      expect(get).toHaveBeenCalledTimes(3);

      expect(await client.validateCode('D', 'http://x.sys', 'http://vs/1')).toBe(false);
      expect(get).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      vi.doUnmock('axios');
    }
  });

  it('keeps fail-open acceptance with explicit unavailable evidence when no terminology server is configured', async () => {
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

    expect(result).toEqual({
      valid: true,
      reason: 'no-server',
      message: 'CodeSystem membership was not verified because no terminology server is configured.',
    });
    expect(get).not.toHaveBeenCalled();

    vi.doUnmock('axios');
  });

  it('sends Coding.version and keeps SNOMED editions in separate cache entries', async () => {
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
        default: { ...actual.default, get },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient } = await import('../terminology-api-client');
    const client = new TerminologyApiClient({
      strategy: 'server-first',
      serverUrl: 'https://snomed.example/fhir',
    });
    const system = 'http://snomed.info/sct';
    const international = 'http://snomed.info/sct/900000000000207008/version/20250701';
    const national = 'http://snomed.info/sct/999000041000000102/version/20250701';

    await client.validateCodeInCodeSystem('123456', system, undefined, undefined, international);
    await client.validateCodeInCodeSystem('123456', system, undefined, undefined, international);
    await client.validateCodeInCodeSystem('123456', system, undefined, undefined, national);

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]?.[1]).toMatchObject({ params: { version: international } });
    expect(get.mock.calls[1]?.[1]).toMatchObject({ params: { version: national } });
    vi.doUnmock('axios');
  });

  it('isolates direct CodeSystem circuit breakers by terminology server', async () => {
    vi.resetModules();
    const brokenServer = 'https://broken-tx.example.com/r4';
    const healthyServer = 'https://healthy-tx.example.com/r4';
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith(brokenServer)) {
        throw new Error('connect ECONNREFUSED');
      }
      return {
        data: {
          resourceType: 'Parameters',
          parameter: [{ name: 'result', valueBoolean: true }],
        },
      };
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
      strategy: 'server-first',
    });

    for (const code of ['A', 'B', 'C']) {
      await client.validateCodeInCodeSystem(
        code,
        'http://loinc.org',
        undefined,
        { url: brokenServer },
      );
    }

    const healthyResult = await client.validateCodeInCodeSystem(
      'D',
      'http://loinc.org',
      undefined,
      { url: healthyServer },
    );

    expect(healthyResult).toMatchObject({ valid: true });
    expect(get).toHaveBeenCalledTimes(4);
    expect(get.mock.calls[3]?.[0]).toBe(
      `${healthyServer}/CodeSystem/$validate-code`,
    );

    vi.doUnmock('axios');
  });

  it('does not reuse OAuth tokens across scoped terminology servers', async () => {
    vi.resetModules();
    const post = vi.fn()
      .mockResolvedValueOnce({
        data: { access_token: 'token-a', expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        data: { access_token: 'token-b', expires_in: 3600 },
      });
    const get = vi.fn().mockImplementation(async (
      _url: string,
      requestConfig: { headers: { Authorization?: string } },
    ) => ({
      data: {
        resourceType: 'Parameters',
        parameter: [{
          name: 'result',
          valueBoolean: requestConfig.headers.Authorization === 'Bearer token-a',
        }],
      },
    }));

    vi.doMock('axios', async () => {
      const actual = await vi.importActual<typeof import('axios')>('axios');
      return {
        ...actual,
        default: {
          ...actual.default,
          get,
          post,
        },
        isAxiosError: actual.isAxiosError,
      };
    });

    const { TerminologyApiClient } = await import('../terminology-api-client');
    const client = new TerminologyApiClient({
      strategy: 'server-first',
    });
    const sharedServerUrl = 'https://tx.example.com/r4';
    const firstServer = {
      url: sharedServerUrl,
      auth: {
        type: 'oauth2' as const,
        clientId: 'client-a',
        clientSecret: 'secret-a',
        tokenUrl: 'https://auth-a.example.com/token',
      },
    };
    const secondServer = {
      url: sharedServerUrl,
      auth: {
        type: 'oauth2' as const,
        clientId: 'client-b',
        clientSecret: 'secret-b',
        tokenUrl: 'https://auth-b.example.com/token',
      },
    };

    const firstResult = await client.validateCode(
      'A',
      'http://loinc.org',
      'http://example.test/ValueSet/shared',
      'required',
      firstServer,
    );
    const secondResult = await client.validateCode(
      'A',
      'http://loinc.org',
      'http://example.test/ValueSet/shared',
      'required',
      secondServer,
    );

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer token-a');
    expect(get.mock.calls[1]?.[1]?.headers.Authorization).toBe('Bearer token-b');

    vi.doUnmock('axios');
  });

  it('isolates direct CodeSystem results by auth scope on a shared server URL', async () => {
    vi.resetModules();
    const get = vi.fn().mockImplementation(async (
      _url: string,
      requestConfig: { headers: { Authorization?: string } },
    ) => ({
      data: {
        resourceType: 'Parameters',
        parameter: [{
          name: 'result',
          valueBoolean: requestConfig.headers.Authorization === 'Bearer tenant-a',
        }],
      },
    }));

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
    const client = new TerminologyApiClient({ strategy: 'server-first' });
    const serverUrl = 'https://shared-tx.example.com/r4';
    const firstResult = await client.validateCodeInCodeSystem(
      'A',
      'http://loinc.org',
      undefined,
      {
        url: serverUrl,
        auth: { type: 'bearer', token: 'tenant-a' },
      },
    );
    const secondResult = await client.validateCodeInCodeSystem(
      'A',
      'http://loinc.org',
      undefined,
      {
        url: serverUrl,
        auth: { type: 'bearer', token: 'tenant-b' },
      },
    );

    expect(firstResult.valid).toBe(true);
    expect(secondResult.valid).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);

    vi.doUnmock('axios');
  });

  it('fails open after the remote CodeSystem validation budget is exhausted', async () => {
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
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: true,
        cacheResults: true,
        cacheTTLSeconds: 3600,
        maxRemoteCodeSystemValidations: 2,
      },
    });

    await client.validateCodeInCodeSystem('A', 'http://loinc.org');
    await client.validateCodeInCodeSystem('B', 'http://loinc.org');
    client.setConfig({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: true,
        cacheResults: true,
        cacheTTLSeconds: 3600,
        maxRemoteCodeSystemValidations: 2,
      },
    });
    const exhaustedResult = await client.validateCodeInCodeSystem('C', 'http://loinc.org');

    expect(exhaustedResult).toMatchObject({
      valid: true,
      reason: 'remote-budget-exhausted',
    });
    expect(exhaustedResult.message).not.toContain('tx.example.com');
    expect(get).toHaveBeenCalledTimes(2);

    vi.doUnmock('axios');
  });

  it('coalesces concurrent direct CodeSystem validations before reserving remote budget', async () => {
    vi.resetModules();
    let resolveGet: ((value: unknown) => void) | undefined;
    const get = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveGet = resolve;
    }));

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
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
      serverDelegation: {
        expandValueSets: true,
        validateCodes: true,
        cacheResults: true,
        cacheTTLSeconds: 3600,
        maxRemoteCodeSystemValidations: 1,
      },
    });

    const first = client.validateCodeInCodeSystem('A', 'http://loinc.org');
    const second = client.validateCodeInCodeSystem('A', 'http://loinc.org');
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    resolveGet?.({
      data: {
        resourceType: 'Parameters',
        parameter: [{ name: 'result', valueBoolean: true }],
      },
    });

    const results = await Promise.all([first, second]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ valid: true });
    expect(results[1]).toMatchObject({ valid: true });
    expect(get).toHaveBeenCalledTimes(1);

    const exhaustedResult = await client.validateCodeInCodeSystem('B', 'http://loinc.org');
    expect(exhaustedResult).toMatchObject({
      valid: true,
      reason: 'remote-budget-exhausted',
    });

    vi.doUnmock('axios');
  });

  it('keeps validator-owned operation caches isolated and clears only its owner', async () => {
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

    const { TerminologyApiClient } =
      await import('../terminology-api-client');
    const { ValueSetValidator } = await import('../valueset-validator');
    const { ValueSetCache } = await import('../valueset-cache');
    const { TerminologyOperationCache } = await import('../terminology-operation-cache');
    const apiOperationCache = new TerminologyOperationCache();
    const client = new TerminologyApiClient({
      serverUrl: 'https://tx.example.com/r4',
      strategy: 'server-first',
    }, new ValueSetCache(), apiOperationCache);
    const size = () => apiOperationCache.getStats().validateCodeResultCount;

    await client.validateCode('A', 'http://x.sys', 'http://vs/1');
    expect(size()).toBe(1);

    const ownedOperationCache = new TerminologyOperationCache();
    ownedOperationCache.storeValidateCode('owned-result', true);
    const validator = new ValueSetValidator(
      new ValueSetCache(),
      ownedOperationCache,
    );
    expect(validator.getCacheStats().validateCodeResultCount).toBe(1);

    validator.clearCache();

    expect(size()).toBe(1);
    expect(validator.getCacheStats().validateCodeResultCount).toBe(0);

    apiOperationCache.clearValidateCode();
    expect(size()).toBe(0);

    vi.doUnmock('axios');
  });
});
