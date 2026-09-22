import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StructureDefinition } from './structure-definition-types.js';
import { reportUnreadablePackageResource } from '../package/package-store-diagnostics.js';

export type IndexedProfile = {
  sd: StructureDefinition;
  sourceName: string;
};

export type PackageProfileIndex = {
  byUrl: Map<string, IndexedProfile[]>;
  byVersionedUrl: Map<string, IndexedProfile>;
};

/**
 * Reading a package's profiles.
 *
 * The standard `.index.json` carries the URL, version and filename of every
 * resource a package ships, so a lookup can open the one profile it wants
 * instead of parsing the package. Both the targeted read and the full build
 * share the file reader here, so the diagnostics for a broken profile file
 * cannot drift between them.
 */

export async function loadCanonicalUrlsFromPackageIndex(indexPath: string): Promise<Map<string, string[]> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8')) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return null;

    const urls = new Map<string, string[]>();
    for (const entry of parsed.files) {
      if (!entry || typeof entry !== 'object') continue;
      const resource = entry as { resourceType?: unknown; url?: unknown; filename?: unknown };
      if (resource.resourceType !== 'StructureDefinition' || typeof resource.url !== 'string') continue;
      const filename = typeof resource.filename === 'string' ? resource.filename : null;
      // An index may carry `url|version`; the bare form is what callers ask
      // for, and keeping both can only widen the "may contain" answer.
      for (const key of canonicalKeys(resource.url)) {
        const filenames = urls.get(key);
        if (filenames) { if (filename) filenames.push(filename); continue; }
        urls.set(key, filename ? [filename] : []);
      }
    }
    return urls;
  } catch {
    return null;
  }
}

export function canonicalKeys(url: string): string[] {
  const separator = url.indexOf('|');
  return separator < 0 ? [url] : [url, url.slice(0, separator)];
}

export async function readProfileFile(
  packagePath: string,
  filename: string,
): Promise<StructureDefinition | null> {
  try {
    const profile = JSON.parse(
      await fs.readFile(path.join(packagePath, filename), 'utf-8'),
    ) as StructureDefinition;
    return profile?.resourceType === 'StructureDefinition' && typeof profile.url === 'string'
      ? profile
      : null;
  } catch (error) {
    reportUnreadablePackageResource('SDLoader', path.join(packagePath, filename), error);
    return null;
  }
}

export function addProfileToIndex(
  index: PackageProfileIndex,
  profile: StructureDefinition,
  packageName: string,
  filename: string,
): void {
  const indexed: IndexedProfile = { sd: profile, sourceName: `${packageName}/${filename}` };
  const candidates = index.byUrl.get(profile.url) ?? [];
  candidates.push(indexed);
  index.byUrl.set(profile.url, candidates);
  if (typeof profile.version === 'string' && profile.version.length > 0) {
    index.byVersionedUrl.set(`${profile.url}|${profile.version}`, indexed);
  }
}
