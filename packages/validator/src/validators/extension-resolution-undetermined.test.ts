/** A loader failure must not turn an intact extension into a finding. */

import { describe, expect, it } from 'vitest';
import { validateUniversalExtensionRules } from './extension-universal-rules';
import { ExtensionUrlResolver } from './extension-url-resolver';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader';
import type { ExtensionValidationContext } from './extension-types';

const context: ExtensionValidationContext = {
  resource: { resourceType: 'Patient', id: 'p1' },
  profileSD: { resourceType: 'StructureDefinition' } as ExtensionValidationContext['profileSD'],
  strictMode: false,
  fhirVersion: 'R4',
  profileUrl: 'https://acme.test/fhir/StructureDefinition/patient',
  getValueAtPath: () => undefined,
};

// A registry-domain URL, because those are the ones expected to resolve.
const URL = 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace';

function runRules(
  extensionType: 'extension' | 'modifierExtension',
  resolution: 'resolvable' | 'unresolvable' | 'undetermined',
) {
  return validateUniversalExtensionRules({
    extension: { url: URL, valueString: 'x' },
    extensionType,
    path: `Patient.${extensionType}[0]`,
    knownUrls: new Set<string>(),
    context,
    visited: new Set<string>(),
    depth: 0,
    maxNestedExtensionDepth: 5,
    resolveExtensionUrl: async () => resolution,
    getDeclaredContexts: async () => null,
    site: { resourceType: 'Patient', elementPath: 'Patient', attachment: 'resource-root' as const },
  });
}

describe('extension URL resolution that could not be determined', () => {
  it('does not report a modifierExtension as not-found on a loader failure', async () => {
    const issues = await runRules('modifierExtension', 'undetermined');
    expect(issues.map(issue => issue.code)).not.toContain('profile-extension-not-found');
  });

  it('does not report a plain extension as not-found either', async () => {
    const issues = await runRules('extension', 'undetermined');
    expect(issues.map(issue => issue.code)).not.toContain('profile-extension-not-found');
  });

  it('still reports a genuinely unresolvable modifierExtension as an error', async () => {
    const issues = await runRules('modifierExtension', 'unresolvable');
    const notFound = issues.filter(issue => issue.code === 'profile-extension-not-found');
    expect(notFound).toHaveLength(1);
    expect(notFound[0].severity).toBe('error');
  });

  it('stays quiet for an extension that resolves', async () => {
    const issues = await runRules('extension', 'resolvable');
    expect(issues.map(issue => issue.code)).not.toContain('profile-extension-not-found');
  });
});

describe('ExtensionUrlResolver.resolveKnown', () => {
  const url = 'http://example.org/StructureDefinition/thing';

  function resolverWith(loadProfile: () => Promise<unknown>): ExtensionUrlResolver {
    return new ExtensionUrlResolver({ loadProfile } as unknown as StructureDefinitionLoader);
  }

  it('separates a loader failure from a definition that is not there', async () => {
    await expect(resolverWith(() => Promise.reject(new Error('io')))
      .resolveKnown(url, 'R4')).resolves.toBe('undetermined');
    await expect(resolverWith(() => Promise.resolve(null))
      .resolveKnown(url, 'R4')).resolves.toBe('unresolvable');
    await expect(resolverWith(() => Promise.resolve({ resourceType: 'StructureDefinition' }))
      .resolveKnown(url, 'R4')).resolves.toBe('resolvable');
  });

  it('does not cache an undetermined answer as resolvable', async () => {
    let attempt = 0;
    const resolver = resolverWith(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('io')) : Promise.resolve(null);
    });

    await expect(resolver.resolveKnown(url, 'R4')).resolves.toBe('undetermined');
    await expect(resolver.resolveKnown(url, 'R4')).resolves.toBe('unresolvable');
  });
});
