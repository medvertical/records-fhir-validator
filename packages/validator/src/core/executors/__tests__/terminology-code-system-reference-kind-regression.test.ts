import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValueSetCache } from '../../../validators/valueset-cache';
import { clearPackageCanonicalIndex } from '../../../validators/valueset-package-search';
import {
  CodeSystemReferenceLookupCache,
  validateCodeSystemReference,
} from '../terminology-code-system-reference-rules';
import { setProfileSource, type ProfileSourceContext } from '../../../persistence';
import {
  ValueSetValidator,
  type TerminologyDefinitionLookup,
} from '../../../validators/valueset-validator';

const packageRoots: string[] = [];

const valueSetSystem = 'http://hl7.org/fhir/ValueSet/communication-category';
const coding = { system: valueSetSystem, code: 'alert' };
const codingPath = 'Communication.category[0].coding';
const systemPath = `${codingPath}[0].system`;
const sourceContext: ProfileSourceContext = {
  organizationId: 7,
  serverId: 314,
  fhirVersion: 'R4',
};

async function knownValueSetLookup(context?: ProfileSourceContext) {
  const validator = new ValueSetValidator();
  const lookup = validator.getDefinitionLookup();
  const valueSet = await validator.withSourceContext(context, () =>
    lookup.packageLoader.loadValueSetResource(valueSetSystem, 'R4'),
  );
  expect(valueSet).toMatchObject({ resourceType: 'ValueSet', url: valueSetSystem });
  const valueSetRead = vi.spyOn(lookup.packageLoader, 'loadValueSetResource');
  return { lookup, valueSetRead };
}

function validateSystemKind(lookup: TerminologyDefinitionLookup, context?: ProfileSourceContext,
  referenceCache = new CodeSystemReferenceLookupCache()) {
  return validateCodeSystemReference(
    coding, codingPath, 0, true, 'syntax', 'R4', context,
    lookup.cache, referenceCache, lookup,
  );
}

describe('Coding.system kind evidence', () => {
  beforeEach(() => {
    setProfileSource({});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setProfileSource({});
    clearPackageCanonicalIndex();
    await Promise.all(packageRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('keeps a rejected tenant CodeSystem lookup undecided despite a known ValueSet', async () => {
    const hasCodeSystem = vi.fn().mockRejectedValue(new Error('CodeSystem host lookup failed'));
    setProfileSource({ hasCodeSystem });
    const { lookup, valueSetRead } = await knownValueSetLookup(sourceContext);
    const packageCodeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');

    const issues = await validateSystemKind(lookup, sourceContext);

    expect(valueSetRead).toHaveBeenCalledExactlyOnceWith(valueSetSystem, 'R4');
    expect(hasCodeSystem).toHaveBeenCalledExactlyOnceWith(valueSetSystem, undefined, sourceContext);
    expect(packageCodeSystemRead).not.toHaveBeenCalled();
    expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
  });

  it('keeps a rejected package CodeSystem lookup undecided despite a known ValueSet', async () => {
    const { lookup, valueSetRead } = await knownValueSetLookup();
    const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome')
      .mockRejectedValue(new Error('CodeSystem package lookup failed'));

    const issues = await validateSystemKind(lookup);

    expect(valueSetRead).toHaveBeenCalledExactlyOnceWith(valueSetSystem, 'R4');
    expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
    expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
  });

  it('rejects a known ValueSet when the tenant successfully confirms CodeSystem absence', async () => {
    const hasCodeSystem = vi.fn().mockResolvedValue(false);
    const findCanonicalResource = vi.fn().mockResolvedValue(null);
    setProfileSource({ hasCodeSystem, findCanonicalResource });
    const { lookup, valueSetRead } = await knownValueSetLookup(sourceContext);
    const packageCodeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');

    const issues = await validateSystemKind(lookup, sourceContext);

    expect(valueSetRead).toHaveBeenCalledExactlyOnceWith(valueSetSystem, 'R4');
    expect(hasCodeSystem).toHaveBeenCalledExactlyOnceWith(valueSetSystem, undefined, sourceContext);
    expect(packageCodeSystemRead).toHaveBeenCalledOnce();
    expect(packageCodeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(packageCodeSystemRead.mock.calls[0][2]).toBeUndefined();
    await expect(packageCodeSystemRead.mock.results[0].value).resolves.toEqual({ codeSystem: null, blocked: false });
    expect(findCanonicalResource.mock.calls.filter(call => call[1] === 'CodeSystem'))
      .toEqual([[valueSetSystem, 'CodeSystem', undefined, sourceContext]]);
    expect(issues).toEqual([expect.objectContaining({
      severity: 'error',
      code: 'terminology-coding-system-valueset',
      path: systemPath,
    })]);
  });

  it('rejects a known ValueSet when the actual package lookup successfully returns no CodeSystem', async () => {
    const { lookup, valueSetRead } = await knownValueSetLookup();
    const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');

    const issues = await validateSystemKind(lookup);

    expect(valueSetRead).toHaveBeenCalledExactlyOnceWith(valueSetSystem, 'R4');
    expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
    await expect(codeSystemRead.mock.results[0].value).resolves.toEqual({ codeSystem: null, blocked: false });
    expect(issues).toEqual([expect.objectContaining({
      severity: 'error',
      code: 'terminology-coding-system-valueset',
      path: systemPath,
    })]);
  });

  it.each(['complete', 'not-present'] as const)(
    'recognizes a same-canonical %s CodeSystem as kind evidence independently of membership',
    async content => {
      const { lookup, valueSetRead } = await knownValueSetLookup();
      const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome').mockResolvedValue({ codeSystem: {
        resourceType: 'CodeSystem',
        url: valueSetSystem,
        version: '4.0.1',
        status: 'active',
        content,
        ...(content === 'complete' ? { concept: [{ code: 'alert' }] } : {}),
      }, blocked: false });

      const issues = await validateSystemKind(lookup);

      expect(valueSetRead).toHaveBeenCalledExactlyOnceWith(valueSetSystem, 'R4');
      expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
      expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
    },
  );

  it('keeps the actual host canonical lookup rejection unknown cold and warm', async () => {
    const findCanonicalResource = vi.fn(async (_url: string, resourceType: string) => {
      if (resourceType === 'CodeSystem') throw new Error('Host unavailable');
      return null;
    });
    setProfileSource({ findCanonicalResource });
    const { lookup } = await knownValueSetLookup(sourceContext);
    const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');
    const referenceCache = new CodeSystemReferenceLookupCache();

    for (let round = 0; round < 2; round++) {
      const issues = await validateSystemKind(lookup, sourceContext, referenceCache);
      expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
    }

    expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
    await expect(codeSystemRead.mock.results[0].value).resolves.toEqual({ codeSystem: null, blocked: true });
    expect(findCanonicalResource.mock.calls.filter(call => call[1] === 'CodeSystem'))
      .toEqual([[valueSetSystem, 'CodeSystem', undefined, sourceContext]]);
  });

  it('does not infer CodeSystem absence from a false host membership check when selection fails', async () => {
    const hasCodeSystem = vi.fn().mockResolvedValue(false);
    const findCanonicalResource = vi.fn(async (_url: string, resourceType: string) => {
      if (resourceType === 'CodeSystem') throw new Error('Host unavailable');
      return null;
    });
    setProfileSource({ hasCodeSystem, findCanonicalResource });
    const { lookup } = await knownValueSetLookup(sourceContext);
    const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');

    const issues = await validateSystemKind(lookup, sourceContext);

    expect(hasCodeSystem).toHaveBeenCalledExactlyOnceWith(valueSetSystem, undefined, sourceContext);
    expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
    await expect(codeSystemRead.mock.results[0].value).resolves.toEqual({ codeSystem: null, blocked: true });
    expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
  });

  it('uses a selected host not-present CodeSystem as kind evidence after false membership availability', async () => {
    const selectedCodeSystem = {
      resourceType: 'CodeSystem', url: valueSetSystem, version: '4.0.1',
      status: 'active', content: 'not-present',
    };
    const hasCodeSystem = vi.fn().mockResolvedValue(false);
    const findCanonicalResource = vi.fn(async (_url: string, resourceType: string) =>
      resourceType === 'CodeSystem' ? selectedCodeSystem : null,
    );
    setProfileSource({ hasCodeSystem, findCanonicalResource });
    const { lookup } = await knownValueSetLookup(sourceContext);
    const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');

    const issues = await validateSystemKind(lookup, sourceContext);

    expect(hasCodeSystem).toHaveBeenCalledExactlyOnceWith(valueSetSystem, undefined, sourceContext);
    expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
    await expect(codeSystemRead.mock.results[0].value).resolves.toEqual({ codeSystem: selectedCodeSystem, blocked: false });
    expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
  });

  it('keeps an indexed CodeSystem with invalid JSON unknown cold and warm', async () => {
    const genuine = new ValueSetValidator().getDefinitionLookup();
    const valueSet = await genuine.packageLoader.loadValueSetResource(valueSetSystem, 'R4');
    expect(valueSet).toMatchObject({ resourceType: 'ValueSet', url: valueSetSystem });
    const root = await mkdtemp(join(tmpdir(), 'records-kind-declaration-'));
    packageRoots.push(root);
    const packagePath = join(root, 'kind-evidence#1.0.0', 'package');
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({
      name: 'kind-evidence', version: '1.0.0', fhirVersions: ['4.0.1'],
    }));
    await writeFile(join(packagePath, '.index.json'), JSON.stringify({
      'index-version': 2,
      files: [
        { filename: 'ValueSet-owned.json', resourceType: 'ValueSet', url: valueSetSystem },
        { filename: 'CodeSystem-owned.json', resourceType: 'CodeSystem', url: valueSetSystem },
      ],
    }));
    await writeFile(join(packagePath, 'ValueSet-owned.json'), JSON.stringify(valueSet));
    await writeFile(join(packagePath, 'CodeSystem-owned.json'), '{');
    clearPackageCanonicalIndex();
    const lookup = new ValueSetValidator(new ValueSetCache(), undefined, [root]).getDefinitionLookup();
    await expect(lookup.packageLoader.loadValueSetResource(valueSetSystem, 'R4')).resolves.toMatchObject({
      resourceType: 'ValueSet', url: valueSetSystem,
    });
    const codeSystemRead = vi.spyOn(lookup.packageLoader, 'loadCodeSystemOutcome');
    const referenceCache = new CodeSystemReferenceLookupCache();

    for (let round = 0; round < 2; round++) {
      const issues = await validateSystemKind(lookup, undefined, referenceCache);
      expect(issues.filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
    }

    expect(codeSystemRead).toHaveBeenCalledOnce();
    expect(codeSystemRead.mock.calls[0].slice(0, 2)).toEqual([valueSetSystem, '4']);
    expect(codeSystemRead.mock.calls[0][2]).toBeUndefined();
    await expect(codeSystemRead.mock.results[0].value).resolves.toEqual({ codeSystem: null, blocked: true });
  });
});
