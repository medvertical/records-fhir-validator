import { exampleFolderDeclarations, readExampleFolderResource } from '../package/package-example-folders.js';
import { isSameMajorFallback } from './valueset-package-search.js';

/**
 * A CodeSystem or ValueSet that an installed package defines only among its
 * examples (CPG's `chf-codes`), for a canonical no package root declares.
 */
export async function findInExampleFolders<T extends { url?: string; version?: string; resourceType?: string }>(
  directories: string[],
  resourceType: string,
  canonical: string,
  requestedVersion?: string,
  onUnusableDeclaration?: () => void,
): Promise<T | null> {
  const url = canonical.split('|')[0];
  let fallback: T | null = null;
  for (const declaration of await exampleFolderDeclarations(directories, resourceType, url)) {
    const resource = await readExampleFolderResource<T>(declaration.file);
    if (!resource || resource.url !== url || resource.resourceType !== resourceType) { onUnusableDeclaration?.(); continue; }
    if (!requestedVersion || resource.version === requestedVersion) return resource;
    if (isSameMajorFallback(resource.version, requestedVersion)) fallback ??= resource;
  }
  return fallback;
}
