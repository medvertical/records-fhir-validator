/** Severity contract for unresolved extension URLs (reference-validator parity). */

import { describe, expect, it, vi } from 'vitest';
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
  // sqlonfhir-r4 Bundle/26b55f5c: the reference validator has cross-version
  // paths only for the releases of hl7.fhir.xver-extensions#0.1.0.
  it.each(['6.0', '4.3'])('rejects a cross-version extension URL for release %s', async (release) => {
    const url = `http://hl7.org/fhir/${release}/StructureDefinition/extension-Person.deceased[x]`;
    const issues = await runRules('extension', false, url);
    expect(issues.map(issue => [issue.code, issue.severity, issue.message])).toEqual([[
      'profile-extension-url-version-invalid',
      'error',
      `Extension url '${url}' is not valid (invalid Version '${release}')`,
    ]]);
  });

  it('accepts a cross-version extension URL for a covered release', async () => {
    const issues = await runRules('extension', false, 'http://hl7.org/fhir/5.0/StructureDefinition/extension-Patient.gender');
    expect(issues).toEqual([]);
  });

  it('rejects an unknown private-domain plain extension URL like the reference validator', async () => {
    const issues = await runRules('extension', false);
    const notFound = issues.filter((i) => i.code === 'profile-extension-not-found');
    expect(notFound).toHaveLength(1);
    expect(notFound[0].severity).toBe('error');
    expect(notFound[0].message).toContain('could not be found so is not allowed here');
  });

  it('rejects an unresolvable registry-domain plain extension URL', async () => {
    const issues = await runRules(
      'extension',
      false,
      'http://hl7.org/fhir/us/cqfmeasures/StructureDefinition/cqfm-populationBasis',
    );
    const notFound = issues.filter((i) => i.code === 'profile-extension-not-found');
    expect(notFound).toHaveLength(1);
    expect(notFound[0].severity).toBe('error');
  });

  it('accepts undefined extensions the reference validator allows', async () => {
    for (const url of [
      'http://dicom.nema.org/resources/ontology/DCM/extension',
      'http://hl7.org/fhir/StructureDefinition/structuredefinition-expression',
    ]) {
      const issues = await runRules('extension', false, url);
      expect(issues.filter((i) => i.code === 'profile-extension-not-found')).toEqual([]);
    }
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

describe('validateUniversalExtensionRules — definition of an unsliced extension', () => {
  const site = { resourceType: 'Patient', elementPath: 'Patient', attachment: 'resource-root' as const };

  async function run(url: string, knownUrls: Set<string>) {
    const validateAgainstDefinition = vi.fn(async () => []);
    await validateUniversalExtensionRules({
      extension: { url, valueString: 'x' },
      extensionType: 'extension',
      path: 'Patient.extension[0]',
      knownUrls,
      context,
      visited: new Set<string>(),
      depth: 0,
      maxNestedExtensionDepth: 5,
      resolveExtensionUrl: async () => 'resolvable' as const,
      getDeclaredContexts: async () => null,
      validateAgainstDefinition,
      site,
    });
    return validateAgainstDefinition;
  }

  it('checks an extension the profile does not slice against its own definition', async () => {
    const url = 'http://example.org/fhir/StructureDefinition/ext';

    expect(await run(url, new Set())).toHaveBeenCalledWith(expect.objectContaining({ url }), url, 'Patient.extension[0]');
  });

  it('leaves extensions the profile slices, and versioned URLs, to the other checks', async () => {
    const url = 'http://example.org/fhir/StructureDefinition/ext';

    expect(await run(url, new Set([url]))).not.toHaveBeenCalled();
    expect(await run(`${url}|1.0.0`, new Set())).not.toHaveBeenCalled();
  });
});
