/** Severity contract for unresolved extension URLs (FHIR open-world model). */

import { describe, expect, it } from 'vitest';
import { validateUniversalExtensionRules } from '../extension-universal-rules';
import type { ExtensionValidationContext } from '../extension-types';

const context: ExtensionValidationContext = {
  resource: { resourceType: 'Patient', id: 'p1' },
  profileSD: { resourceType: 'StructureDefinition' } as ExtensionValidationContext['profileSD'],
  strictMode: false,
  fhirVersion: 'R4',
  profileUrl: 'https://acme.test/fhir/StructureDefinition/patient',
  getValueAtPath: () => undefined,
};

async function runRules(
  extensionType: 'extension' | 'modifierExtension',
  resolvable: boolean,
  url = 'https://private.acme.test/fhir/StructureDefinition/internal-flag',
) {
  return validateUniversalExtensionRules({
    extension: {
      url,
      valueString: 'x',
    },
    extensionType,
    path: `Patient.${extensionType}[0]`,
    knownUrls: new Set<string>(),
    context,
    visited: new Set<string>(),
    depth: 0,
    maxNestedExtensionDepth: 5,
    resolveExtensionUrl: async () => (resolvable ? 'resolvable' as const : 'unresolvable' as const),
    getDeclaredContexts: async () => null,
    site: {
      resourceType: 'Patient',
      elementPath: 'Patient',
      attachment: 'resource-root' as const,
    },
  });
}

describe('validateUniversalExtensionRules — unresolved URL severity', () => {
  it('reports an unknown private-domain plain extension URL as information', async () => {
    const issues = await runRules('extension', false);
    const notFound = issues.filter((i) => i.code === 'profile-extension-not-found');
    expect(notFound).toHaveLength(1);
    expect(notFound[0].severity).toBe('information');
  });

  it('reports an unresolvable registry-domain plain extension URL as warning', async () => {
    const issues = await runRules(
      'extension',
      false,
      'http://hl7.org/fhir/us/cqfmeasures/StructureDefinition/cqfm-populationBasis',
    );
    const notFound = issues.filter((i) => i.code === 'profile-extension-not-found');
    expect(notFound).toHaveLength(1);
    expect(notFound[0].severity).toBe('warning');
  });

  it('reports an unknown modifierExtension URL as error', async () => {
    const issues = await runRules('modifierExtension', false);
    const notFound = issues.filter((i) => i.code === 'profile-extension-not-found');
    expect(notFound).toHaveLength(1);
    expect(notFound[0].severity).toBe('error');
    expect(notFound[0].message).toContain('modifier extension');
  });

  it('stays silent for a resolvable extension URL', async () => {
    const issues = await runRules('extension', true);
    expect(
      issues.filter((i) => i.code === 'profile-extension-not-found'),
    ).toHaveLength(0);
  });
});
