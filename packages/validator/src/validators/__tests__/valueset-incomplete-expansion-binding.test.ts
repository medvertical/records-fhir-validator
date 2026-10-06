/**
 * VSAC packages up to 0.11.0 stored only the first 1000 codes of a larger
 * expansion (`total` 81405, 1000 `contains`). A code beyond those is not
 * provably outside the value set, so a required-binding miss against such an
 * expansion stays unverified instead of an error.
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

const VALUE_SET_URL = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1010.4';
const NDC = 'http://hl7.org/fhir/sid/ndc';

describe('required binding against a stored expansion shorter than its total', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { force: true, recursive: true })));
  });

  async function harness(total: number) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-incomplete-expansion-'));
    roots.push(root);
    const packagePath = path.join(root, 'us.nlm.vsac#0.11.0', 'package');
    await fs.mkdir(packagePath, { recursive: true });
    await fs.writeFile(path.join(packagePath, 'ValueSet-2.16.840.1.113762.1.4.1010.4.json'), JSON.stringify({
      resourceType: 'ValueSet',
      url: VALUE_SET_URL,
      version: '20170601',
      status: 'active',
      expansion: {
        total,
        contains: [{ system: NDC, code: '0002-1433-80' }, { system: NDC, code: '0002-1434-80' }],
      },
    }));

    const cache = new ValueSetCache();
    const packageLoader = new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([root]));
    const resolutionConfig: TerminologyResolutionConfig = {
      strategy: 'local-only',
      serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0 },
    };
    const terminologyDiagnostics = createEmptyTerminologyDiagnostics();
    const deps = {
      getExpandedValueSet: (valueSetUrl: string, fhirVersion?: 'R4' | 'R5' | 'R6') =>
        expandValueSet({ cache, apiClient: {} as TerminologyApiClient, packageLoader, resolutionConfig }, valueSetUrl, fhirVersion),
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

  const check = (deps: Awaited<ReturnType<typeof harness>>['deps'], code: string) =>
    resolveValueSetCodeBinding(deps, code, NDC, VALUE_SET_URL, 'required', 'R4', 'MedicationDispense.medicationCodeableConcept');

  it('leaves a miss unverified when the stored expansion is cut short', async () => {
    const { deps, terminologyDiagnostics } = await harness(81405);

    await expect(check(deps, '0002-1433-80')).resolves.toBe('valid');
    await expect(check(deps, '55513-0192-01')).resolves.toBe('unverified');
    expect(terminologyDiagnostics.unverifiedBindings.byReason['incomplete-expansion']).toBe(1);
  });

  it('keeps the error when the stored expansion is whole', async () => {
    const { deps } = await harness(2);

    await expect(check(deps, '55513-0192-01')).resolves.toBe('invalid');
  });
});
