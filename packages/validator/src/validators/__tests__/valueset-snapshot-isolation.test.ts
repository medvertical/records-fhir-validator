import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultValidationSettings } from '@records-fhir/validation-types';
import { setProfileSource, type ProfileSourceContext } from '../../persistence/index.js';
import { buildTerminologyResolutionConfig } from '../../core/validator-runtime-settings.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';

afterEach(() => { setProfileSource({}); vi.unstubAllGlobals(); });

describe('snapshot terminology execution', () => {
  it('returns an unresolved result for a frozen unavailable required binding without provider fallback', async () => {
    const fetch = vi.fn(() => { throw new Error('Unexpected external request'); });
    vi.stubGlobal('fetch', fetch);
    setProfileSource({ findCanonicalResource: async () => null });
    const validator = new ValueSetValidator();
    const settings = createDefaultValidationSettings('R4');
    settings.terminologyResolution!.snapshot = { sha256: 'a'.repeat(64) };
    validator.setResolutionConfig(buildTerminologyResolutionConfig(settings));
    const result = await validator.withSourceContext({ organizationId: 1, serverId: 491, fhirVersion: 'R4', terminologySnapshotSha256: 'a'.repeat(64) },
      () => validator.resolveCodeBindingForBinding('example', 'https://www.meddra.org', 'https://example.test/required-vs', 'required', 'R4'));
    expect(result).not.toBe('valid');
    expect(result).not.toBe('invalid');
    const unavailable = await validator.withSourceContext({ organizationId: 1, serverId: 491, fhirVersion: 'R4', terminologySnapshotSha256: 'a'.repeat(64) },
      () => validator.validateCodeInCodeSystem('example', 'https://www.meddra.org', undefined, 'R4'));
    expect(unavailable.reason).toBe('snapshot-unavailable');
    expect(isVerifiedCodeSystemResult(unavailable)).toBe(false);
    expect(buildCodeSystemResultIssues({ system: 'https://www.meddra.org', code: 'example' }, unavailable, 'AdverseEvent.event.coding', 0, true))
      .toEqual([expect.objectContaining({ code: 'terminology-codesystem-unverified', details: expect.objectContaining({ validationComplete: false }) })]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps overlapping snapshots separate and never falls through to mutable stores or external requests', async () => {
    const fetch = vi.fn(() => { throw new Error('Unexpected external request'); });
    vi.stubGlobal('fetch', fetch);
    const canonical = 'https://example.test/value-set';
    const system = 'https://example.test/code-system';
    const source = vi.fn(async (url: string, type: string, _version: string | undefined, context?: ProfileSourceContext) => {
      await Promise.resolve();
      if (url !== canonical || type !== 'ValueSet') return null;
      return { resourceType: 'ValueSet', url: canonical, status: 'active', compose: {
        include: [{ system, concept: [{ code: context?.terminologySnapshotSha256 === 'a'.repeat(64) ? 'A' : 'B' }] }],
      } };
    });
    setProfileSource({ findCanonicalResource: source });
    const validator = new ValueSetValidator();
    const settings = createDefaultValidationSettings('R4');
    settings.terminologyResolution!.snapshot = { sha256: 'a'.repeat(64) };
    validator.setResolutionConfig(buildTerminologyResolutionConfig(settings));
    const run = (hash: string, code: string) => validator.withSourceContext({ organizationId: 1, fhirVersion: 'R4',
      terminologySnapshotSha256: hash.repeat(64) }, () => validator.resolveCodeBindingForBinding(code, system, canonical, 'required', 'R4'));
    expect(await Promise.all([run('a', 'A'), run('b', 'A'), run('b', 'B'), run('a', 'B')]))
      .toEqual(['valid', 'invalid', 'valid', 'invalid']);
    const missing = await validator.withSourceContext({ organizationId: 1, fhirVersion: 'R4', terminologySnapshotSha256: 'a'.repeat(64) },
      () => validator.getDefinitionLookup().packageLoader.loadValueSetResource('http://hl7.org/fhir/ValueSet/administrative-gender', 'R4'));
    expect(missing).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(validator.getResolutionConfig()).toMatchObject({ strategy: 'local-only', servers: [] });
  });
});
