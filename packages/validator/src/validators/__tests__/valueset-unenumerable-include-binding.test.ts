/**
 * A whole-system compose include whose CodeSystem the local stores cannot
 * enumerate (absent entirely, or pinned to a version with no same-major local
 * candidate) makes the local expansion provably incomplete for that system.
 * A required-binding miss for a code from such a system must degrade to
 * 'unverified' instead of an authoritative error — the shape behind the
 * PDex EOB HIPPS and ProvenanceAgentType false positives. Misses in systems
 * the local stores fully enumerate stay authoritative.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerminologyApiClient } from '../terminology-api-client';
import { resolveValueSetCodeBinding } from '../valueset-code-binding-resolver';
import { ValueSetCache } from '../valueset-cache';
import { createEmptyTerminologyDiagnostics } from '../valueset-diagnostics';
import { expandValueSet } from '../valueset-expansion-loader';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';
import { TwoPhaseShadowEvaluator } from '../valueset-two-phase-shadow';
import type { TerminologyResolutionConfig } from '../valueset-types';

const VALUE_SET_URL = 'http://example.org/fhir/ValueSet/procedure-codes';
const LOCAL_SYSTEM = 'http://example.org/fhir/CodeSystem/local-codes';
const MISSING_SYSTEM = 'https://example.org/external/HIPPSCodes';
const PINNED_SYSTEM = 'http://example.org/fhir/CodeSystem/pinned-codes';

describe('required binding with unenumerable whole-system includes', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { force: true, recursive: true }),
    ));
  });

  interface PackageOptions {
    pinnedVersion?: string;
    pipedVersion?: string;
    onlyUnenumerable?: boolean;
  }

  async function writePackage(root: string, options: PackageOptions): Promise<void> {
    const packagePath = path.join(root, 'example.pkg#1.0.0', 'package');
    await fs.mkdir(packagePath, { recursive: true });
    const include: Array<Record<string, unknown>> = options.onlyUnenumerable
      ? [{ system: MISSING_SYSTEM }]
      : [
        { system: LOCAL_SYSTEM, concept: [{ code: 'not-applicable' }] },
        { system: MISSING_SYSTEM },
      ];
    if (options.pinnedVersion) {
      include.push({ system: PINNED_SYSTEM, version: options.pinnedVersion });
    }
    if (options.pipedVersion) {
      include.push({ system: `${PINNED_SYSTEM}|${options.pipedVersion}` });
    }
    await fs.writeFile(
      path.join(packagePath, 'ValueSet-procedure-codes.json'),
      JSON.stringify({
        resourceType: 'ValueSet',
        url: VALUE_SET_URL,
        version: '1.0.0',
        status: 'active',
        compose: { include },
      }),
    );
    await fs.writeFile(
      path.join(packagePath, 'CodeSystem-pinned-codes.json'),
      JSON.stringify({
        resourceType: 'CodeSystem',
        url: PINNED_SYSTEM,
        version: '2.0.0',
        status: 'active',
        content: 'complete',
        concept: [{ code: 'author' }],
      }),
    );
  }

  async function makeHarness(options: PackageOptions = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-unenumerable-include-'));
    temporaryRoots.push(root);
    await writePackage(root, options);

    const cache = new ValueSetCache();
    const packageLoader = new ValueSetPackageLoader(
      cache,
      new ValueSetPackageResourceAccess([root]),
    );
    const resolutionConfig: TerminologyResolutionConfig = {
      strategy: 'local-only',
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    };
    const apiClient = {} as TerminologyApiClient;
    const terminologyDiagnostics = createEmptyTerminologyDiagnostics();
    const deps = {
      getExpandedValueSet: (valueSetUrl: string, fhirVersion?: 'R4' | 'R5' | 'R6') =>
        expandValueSet({ cache, apiClient, packageLoader, resolutionConfig }, valueSetUrl, fhirVersion),
      hasTerminologyServer: () => false,
      packageLoader,
      resolutionConfig,
      resolveServerForSystem: () => undefined,
      terminologyDiagnostics,
      twoPhaseShadow: new TwoPhaseShadowEvaluator(packageLoader, resolutionConfig.twoPhaseExpansion),
      validateViaServer: async () => 'unverified' as const,
    };
    return { deps, terminologyDiagnostics };
  }

  it("yields 'unverified' for a code from an include whose CodeSystem is absent", async () => {
    const { deps, terminologyDiagnostics } = await makeHarness();

    const outcome = await resolveValueSetCodeBinding(
      deps, 'BB201', MISSING_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'ExplanationOfBenefit.item[0].productOrService',
    );

    expect(outcome).toBe('unverified');
    expect(terminologyDiagnostics.unverifiedBindings.byReason['unenumerable-system-include']).toBe(1);
  });

  it("yields 'unverified' when the include pins a version with no same-major local candidate", async () => {
    const { deps, terminologyDiagnostics } = await makeHarness({ pinnedVersion: '7.0.0' });

    const outcome = await resolveValueSetCodeBinding(
      deps, 'author', PINNED_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'Provenance.agent[0].type',
    );

    expect(outcome).toBe('unverified');
    expect(terminologyDiagnostics.unverifiedBindings.byReason['unenumerable-system-include']).toBe(1);
  });

  it('rejects a code from a system the compose never names, even without an expansion', async () => {
    // The http:// twin of the https:// system the value set includes.
    const otherSystem = MISSING_SYSTEM.replace('https://', 'http://');
    const withLocalConcepts = await makeHarness();
    const withoutExpansion = await makeHarness({ onlyUnenumerable: true });

    await expect(resolveValueSetCodeBinding(
      withLocalConcepts.deps, 'BB201', otherSystem, VALUE_SET_URL, 'required', 'R4',
      'ExplanationOfBenefit.item[0].modifier[0]',
    )).resolves.toBe('invalid');
    await expect(resolveValueSetCodeBinding(
      withoutExpansion.deps, 'BB201', otherSystem, VALUE_SET_URL, 'required', 'R4',
      'ExplanationOfBenefit.item[0].modifier[0]',
    )).resolves.toBe('invalid');
    await expect(resolveValueSetCodeBinding(
      withoutExpansion.deps, 'BB201', MISSING_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'ExplanationOfBenefit.item[0].modifier[0]',
    )).resolves.toBe('unverified');
  });

  it('keeps the authoritative error for a miss in a fully enumerated system', async () => {
    const { deps } = await makeHarness();

    await expect(resolveValueSetCodeBinding(
      deps, 'wrong-code', LOCAL_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'ExplanationOfBenefit.item[0].productOrService',
    )).resolves.toBe('invalid');
  });

  it('accepts codes from an enumerated concept include as valid', async () => {
    const { deps } = await makeHarness();

    await expect(resolveValueSetCodeBinding(
      deps, 'not-applicable', LOCAL_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'ExplanationOfBenefit.item[0].productOrService',
    )).resolves.toBe('valid');
  });

  it('matches a matching pinned include version authoritatively', async () => {
    const { deps } = await makeHarness({ pinnedVersion: '2.0.0' });

    await expect(resolveValueSetCodeBinding(
      deps, 'author', PINNED_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'Provenance.agent[0].type',
    )).resolves.toBe('valid');
  });

  it('keys a versioned "system|version" include under the bare canonical', async () => {
    const { deps } = await makeHarness({ pipedVersion: '2.0.0' });

    await expect(resolveValueSetCodeBinding(
      deps, 'author', PINNED_SYSTEM, VALUE_SET_URL, 'required', 'R4',
      'Provenance.agent[0].type',
    )).resolves.toBe('valid');
  });
});
