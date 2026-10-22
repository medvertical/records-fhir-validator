import { createHash } from 'node:crypto';
import path from 'node:path';
import type { StructureDefinition } from './structure-definition-types.js';
import { readStablePackageFile } from '../package/package-file-read-authority.js';
import { reportUnreadablePackageResource } from '../package/package-store-diagnostics.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';

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
    const result = await readStablePackageFile(path.dirname(indexPath), path.basename(indexPath), 8 * 1024 * 1024);
    if (result.status !== 'read') return null;
    const parsed = JSON.parse(result.bytes.toString('utf8')) as { files?: unknown };
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

export type ProfileFileResult =
  | { status: 'read'; profile: StructureDefinition; sha256: string }
  | { status: 'not-profile' }
  | { status: 'unavailable'; cause: 'unsafe-file' | 'resource-unreadable' | 'resource-too-large' | 'identity-mismatch' | 'source-changed' };

export interface ProfileFileIdentity { resourceType: 'StructureDefinition'; url: string; version?: string; fhirVersion?: unknown }
type ParsedIdentityResult = Exclude<ProfileFileResult, { status: 'read' }>
  | { status: 'read'; profile: ProfileFileIdentity; sha256: string };
type ProfileIdentityResult = Exclude<ParsedIdentityResult, { status: 'read' | 'not-profile' }>
  | { status: 'read'; profile: ProfileFileIdentity; sha256: string; signature: string }
  | { status: 'not-profile'; signature: string };
const parsedIdentities = new BoundedLruCache<string, ParsedIdentityResult>(6_144);
export function clearPackageProfileIdentityCache(): void { parsedIdentities.clear(); }

/** Memoize syntax projection by actual bytes, never the availability or ownership of a file. */
export async function readProfileFileIdentityResult(packagePath: string, filename: string, expectedBoundary?: string): Promise<ParsedIdentityResult> {
  const result = await readProfileFileIdentityWithSignature(packagePath, filename, expectedBoundary);
  if (result.status === 'read') return { status: 'read', sha256: result.sha256, profile: result.profile };
  if (result.status === 'not-profile') return { status: 'not-profile' };
  return result;
}

/** A catalog retains the verified file identity as well as its parsed profile identity. */
export async function readProfileFileIdentityWithSignature(packagePath: string, filename: string, expectedBoundary?: string): Promise<ProfileIdentityResult> {
  try {
    const result = await readStablePackageFile(packagePath, filename, 32 * 1024 * 1024, expectedBoundary);
    if (result.status === 'absent') return { status: 'unavailable', cause: 'resource-unreadable' };
    if (result.status !== 'read') return result;
    const sha256 = createHash('sha256').update(result.bytes).digest('hex');
    let identity = parsedIdentities.get(sha256);
    if (!identity) {
      const parsed = parseProfileBytes(result.bytes, sha256);
      if (parsed.status === 'read') {
        const { resourceType, url, version, fhirVersion } = parsed.profile;
        identity = { status: 'read', sha256, profile: { resourceType, url,
          ...(version !== undefined ? { version } : {}), ...(fhirVersion !== undefined ? { fhirVersion } : {}) } };
      } else identity = parsed;
      // Bound attacker-controlled metadata as well as the number of retained hashes.
      if (identity.status !== 'unavailable' && Buffer.byteLength(JSON.stringify(identity)) <= 2_048) parsedIdentities.set(sha256, identity);
    }
    return identity.status === 'read' ? { ...identity, signature: result.signature, profile: { ...identity.profile } }
      : identity.status === 'not-profile' ? { ...identity, signature: result.signature } : { ...identity };
  } catch (error: unknown) {
    reportUnreadablePackageResource('SDLoader', path.join(packagePath, filename), error);
    return { status: 'unavailable', cause: 'resource-unreadable' };
  }
}

export async function readProfileFileResult(packagePath: string, filename: string, expectedBoundary?: string): Promise<ProfileFileResult> {
  try {
    const result = await readStablePackageFile(packagePath, filename, 32 * 1024 * 1024, expectedBoundary);
    if (result.status === 'absent') return { status: 'unavailable', cause: 'resource-unreadable' };
    if (result.status !== 'read') return result;
    return parseProfileBytes(result.bytes);
  } catch (error: unknown) {
    reportUnreadablePackageResource('SDLoader', path.join(packagePath, filename), error);
    return { status: 'unavailable', cause: 'resource-unreadable' };
  }
}

function parseProfileBytes(bytes: Buffer, sha256?: string): ProfileFileResult {
  const profile = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as StructureDefinition;
  if (typeof profile?.resourceType !== 'string') return { status: 'unavailable', cause: 'identity-mismatch' };
  if (profile.resourceType !== 'StructureDefinition') return { status: 'not-profile' };
  if ((profile.version !== undefined && typeof profile.version !== 'string')
    || (profile.fhirVersion !== undefined && typeof profile.fhirVersion !== 'string')) {
    return { status: 'unavailable', cause: 'identity-mismatch' };
  }
  return typeof profile.url === 'string' ? { status: 'read', profile,
    sha256: sha256 ?? createHash('sha256').update(bytes).digest('hex') } : { status: 'unavailable', cause: 'identity-mismatch' };
}

export async function readProfileFile(packagePath: string, filename: string): Promise<StructureDefinition | null> {
  const result = await readProfileFileResult(packagePath, filename);
  return result.status === 'read' ? result.profile : null;
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
