/**
 * An unverified binding must say why: which local store answered, which
 * servers were asked and how each answered, and what to do about it. The
 * Partial-validation popover shows exactly these details.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource } from '../../persistence';
import type { TerminologyApiClient } from '../terminology-api-client';
import type { RemoteValueSetValidationResult } from '../terminology-api-types';
import type { ValueSet } from '../valueset-types';
import { ValueSetValidator } from '../valueset-validator';

const VS_URL = 'https://example.test/ValueSet/unverified-diagnostics';
const CS_URL = 'https://example.test/CodeSystem/unverified-diagnostics';
const ROUTED = 'https://tx.example.test/r4';
const FALLBACK = 'https://tx-fallback.example.test/r4';
const coding = { coding: [{ system: CS_URL, code: 'A' }] };
const binding = { strength: 'extensible' as const, valueSet: VS_URL };

const originalPackageCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;
let emptyCacheDir: string;

beforeEach(async () => {
  emptyCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'records-empty-cache-'));
  process.env.FHIR_PACKAGE_CACHE_PATH = emptyCacheDir;
});

afterEach(async () => {
  setProfileSource({});
  if (originalPackageCachePath === undefined) delete process.env.FHIR_PACKAGE_CACHE_PATH;
  else process.env.FHIR_PACKAGE_CACHE_PATH = originalPackageCachePath;
  await fs.rm(emptyCacheDir, { recursive: true, force: true });
});

function serverAnswering(
  results: Record<string, Partial<RemoteValueSetValidationResult>>,
): ValueSetValidator {
  const validator = new ValueSetValidator();
  validator.setResolutionConfig({
    strategy: 'local-first',
    serverUrl: ROUTED,
    servers: [
      { id: 'routed', url: ROUTED, enabled: true, fhirVersions: ['R4'] },
      { id: 'fallback', url: FALLBACK, enabled: true, fhirVersions: ['R4'] },
    ],
    reportUnverifiedBindings: true,
  });
  const validateCodeAttempt = vi.fn(async (
    _code: string,
    _system: string | undefined,
    _valueSetUrl: string,
    _strength: unknown,
    override?: { url: string },
  ) => {
    const serverUrl = override?.url ?? ROUTED;
    return { outcome: 'unverified', accepted: false, serverUrl, ...results[serverUrl] };
  });
  const apiClient = (validator as unknown as { runtime: { apiClient: TerminologyApiClient } }).runtime.apiClient;
  Object.assign(apiClient, { validateCodeAttempt });
  return validator;
}

function localOnly(): ValueSetValidator {
  const validator = new ValueSetValidator();
  validator.setResolutionConfig({ strategy: 'local-only', serverUrl: undefined, reportUnverifiedBindings: true });
  return validator;
}

async function firstDetails(validator: ValueSetValidator): Promise<Record<string, unknown>> {
  const issues = await validator.validateBinding(coding, binding, 'Observation.code', { fhirVersion: 'R4' });
  expect(issues).toHaveLength(1);
  return { ...issues[0].details, issueCode: issues[0].code, severity: issues[0].severity };
}

describe('unverified binding diagnostics', () => {
  it('explains a missing definition when no server was asked', async () => {
    const details = await firstDetails(localOnly());

    expect(details).toMatchObject({
      issueCode: 'terminology-binding-unverified',
      reason: 'binding-unverified',
      terminologyDiagnostic: {
        kind: 'binding-unverified',
        cause: 'empty-expansion',
        localExpansion: 'none',
        serverAttempts: [],
        serverSkipped: 'no-server',
        packageScope: 'none',
      },
    });
    expect(details.recommendation).toContain('no terminology server was asked');
  });

  it('names every server that did not know the value set', async () => {
    const details = await firstDetails(serverAnswering({
      [ROUTED]: { reason: 'value-set-not-found' },
      [FALLBACK]: { reason: 'value-set-not-found' },
    }));

    expect(details).toMatchObject({
      issueCode: 'terminology-binding-unverified',
      terminologyDiagnostic: {
        cause: 'empty-expansion',
        serverAttempts: [
          { url: ROUTED, reason: 'value-set-not-found' },
          { url: FALLBACK, reason: 'value-set-not-found' },
        ],
      },
    });
    expect(details.recommendation).toContain('terminology servers do not know it');
  });

  it('reports an execution failure when every server failed instead of answering', async () => {
    const details = await firstDetails(serverAnswering({
      [ROUTED]: { reason: 'server-failure' },
      [FALLBACK]: { reason: 'circuit-open' },
    }));

    expect(details).toMatchObject({
      issueCode: 'terminology-server-failure',
      severity: 'information',
      reason: 'server-failure',
      terminologyDiagnostic: { kind: 'terminology-server-failure' },
    });
    expect(details.recommendation).toContain('did not answer');
  });

  it('records that the tenant packages were part of the search', async () => {
    setProfileSource({ findCanonicalResource: vi.fn(async () => null) });
    const validator = localOnly();
    validator.setSourceContext({ organizationId: 7, fhirVersion: 'R4' });

    const details = await firstDetails(validator);

    expect(details.terminologyDiagnostic).toMatchObject({ packageScope: 'tenant' });
  });

  it('marks a found but locally unenumerable definition as incomplete', async () => {
    const valueSet: ValueSet = {
      resourceType: 'ValueSet',
      url: VS_URL,
      status: 'active',
      compose: { include: [{ system: CS_URL, filter: [{ property: 'concept', op: 'is-a', value: 'root' }] }] },
    };
    setProfileSource({
      findCanonicalResource: vi.fn(async (_url: string, resourceType: string) =>
        resourceType === 'ValueSet' ? valueSet : null),
    });
    const validator = localOnly();
    validator.setSourceContext({ organizationId: 7, fhirVersion: 'R4' });

    const details = await firstDetails(validator);

    expect(details.terminologyDiagnostic).toMatchObject({
      cause: 'unenumerable-system-include',
      localExpansion: 'none',
      packageScope: 'tenant',
    });
    expect(details.recommendation).toContain('compose rules cannot be evaluated locally');
  });
});
