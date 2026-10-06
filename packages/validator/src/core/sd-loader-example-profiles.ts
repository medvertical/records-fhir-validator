import type { StructureDefinition } from './structure-definition-types.js';
import { exampleFolderDeclarations, readExampleFolderResource } from '../package/package-example-folders.js';
import { selectBetterUnversionedProfile, type IndexedProfile } from './sd-loader-package-profile-index.js';
import { parseProfileCanonical, type FhirVersionFamily } from './sd-loader-version-utils.js';

import { profileMatchesCanonical } from './sd-loader-profile-identity.js';

/**
 * A profile an installed package ships only among its examples (CPG's
 * `chf-egfr`, which its example observations declare), for a canonical no
 * package root declares. Candidates must fulfill the requested identity.
 */
export async function loadExampleFolderProfile(
  url: string,
  packageSources: readonly string[],
  fhirVersion: FhirVersionFamily,
): Promise<StructureDefinition | null> {
  const request = parseProfileCanonical(url);
  if (!request) return null;
  const targetUrl = request.canonical;
  let best: IndexedProfile | null = null;
  for (const declaration of await exampleFolderDeclarations(packageSources, 'StructureDefinition', targetUrl)) {
    const sd = await readExampleFolderResource<StructureDefinition>(declaration.file);
    if (!sd || !profileMatchesCanonical(sd, url, fhirVersion)) continue;
    best = selectBetterUnversionedProfile(best, { sd, sourceName: declaration.file });
  }
  return best?.sd ?? null;
}

