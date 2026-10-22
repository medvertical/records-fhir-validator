import { promises as fs } from 'node:fs';
import path from 'node:path';
import { captureValidationDependency } from '../validation-dependency-snapshot.js';
import { readStablePackageFile } from '../package/package-file-read-authority.js';
import { readProfileFileResult } from './sd-loader-package-profile-reader.js';
import { readFallbackInventory, type ProfileDescriptor } from './profile-reference-fallback-catalog.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { selectBetterUnversionedProfile } from './sd-loader-package-profile-index.js';
import { parseProfileCanonical, type FhirVersionFamily } from './sd-loader-version-utils.js';
import type { StructureDefinition } from './structure-definition-types.js';

export interface ProfileReferenceCaptureOwner {
  reuseScope: object;
  currentScope: () => object;
}
export type PackageReference = { status: 'found'; profile: StructureDefinition; filename: string }
  | { status: 'absent' } | { status: 'unavailable'; cause: string };
interface ProfileIdentity { resourceType: 'StructureDefinition'; url: string; version?: string; fhirVersion?: unknown }
interface IndexDeclaration { resourceType: string; url?: string; filename?: string; version?: string }
type PackageIndex = { status: 'read'; files: IndexDeclaration[]; boundary: string } | { status: 'absent'; boundary: string }
  | { status: 'unavailable'; cause: string };

function capture<T>(operation: string, directory: string, read: () => Promise<T>, owner?: ProfileReferenceCaptureOwner) {
  return captureValidationDependency('profile', operation, path.resolve(directory), read, owner?.reuseScope, owner?.currentScope);
}

/** Actual index misses still inspect unindexed content; neither absence nor unreadability is inferred from the index. */
export async function readPackageReference(
  directory: string, canonical: string, family: FhirVersionFamily,
  owner?: ProfileReferenceCaptureOwner, examples = true, expectedBoundary?: string, identityOnly = false,
): Promise<PackageReference> {
  if (expectedBoundary !== undefined && !(await matchesBoundary(directory, expectedBoundary))) {
    return { status: 'unavailable', cause: 'source-changed' };
  }
  const requested = parseProfileCanonical(canonical);
  if (!requested) return { status: 'unavailable', cause: 'identity-mismatch' };
  const index = await capture('profile-reference-package-index', directory, () => readIndex(directory), owner);
  if (index.status === 'unavailable') return index;
  if ((expectedBoundary !== undefined && index.boundary !== expectedBoundary) || !(await matchesBoundary(directory, index.boundary))) {
    return { status: 'unavailable', cause: 'source-changed' };
  }
  const declared = index.status === 'read' ? index.files.filter(item =>
    item.resourceType === 'StructureDefinition' && item.url === requested.canonical) : [];
  const result = declared.length ? await readIndexedReference(directory, declared, canonical, family, index.boundary, identityOnly)
    : await readFallbackReference(directory, canonical, family, owner, index.boundary, identityOnly);
  if (result.status !== 'absent' || !examples) return result;
  const example = await capture('profile-reference-example-directory', directory, () => readExampleDirectory(directory), owner);
  if (example.status !== 'found') return example;
  if (!(await matchesBoundary(directory, example.rootBoundary))) return { status: 'unavailable', cause: 'source-changed' };
  const nested = await readPackageReference(example.directory, canonical, family, owner, false, example.boundary, identityOnly);
  return nested.status === 'found' ? { ...nested, filename: path.join('example', nested.filename) } : nested;
}

async function readIndex(directory: string): Promise<PackageIndex> {
  let boundary: string | undefined;
  try {
    boundary = await fs.realpath(directory);
    const read = await readStablePackageFile(directory, '.index.json', 8 * 1024 * 1024, boundary);
    if (read.status === 'absent') return { status: 'absent', boundary: read.boundary };
    if (read.status !== 'read') return { status: 'unavailable',
      cause: read.cause === 'resource-too-large' ? 'index-unreadable' : read.cause };
    const bytes = read.bytes;
    const index: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(index) || !Array.isArray(index.files)) return { status: 'unavailable', cause: 'index-unreadable' };
    const files: IndexDeclaration[] = [];
    for (const item of index.files) {
      if (!isRecord(item) || typeof item.resourceType !== 'string') return { status: 'unavailable', cause: 'index-unreadable' };
      files.push({ resourceType: item.resourceType,
        ...(typeof item.url === 'string' ? { url: item.url } : {}),
        ...(typeof item.filename === 'string' && item.filename ? { filename: item.filename } : {}),
        ...(typeof item.version === 'string' ? { version: item.version } : {}) });
    }
    return { status: 'read', files, boundary };
  } catch { return { status: 'unavailable', cause: 'index-unreadable' }; }
}

async function readIndexedReference(
  directory: string, declarations: IndexDeclaration[], canonical: string, family: FhirVersionFamily, expectedBoundary?: string, identityOnly = false,
): Promise<PackageReference> {
  let selected: { sd: StructureDefinition; filename: string } | null = null;
  for (const declaration of declarations) {
    if (!declaration.filename) return { status: 'unavailable', cause: 'index-unreadable' };
    const result = await readProfileFileResult(directory, declaration.filename, expectedBoundary);
    if (result.status === 'unavailable') return result;
    if (result.status === 'not-profile' || result.profile.url !== declaration.url
      || (declaration.version !== undefined && result.profile.version !== declaration.version)) {
      return { status: 'unavailable', cause: 'identity-mismatch' };
    }
    if (matchesReferenceIdentity(result.profile, canonical, family, identityOnly)) {
      selected = selectBetterUnversionedProfile(selected, { sd: result.profile, filename: declaration.filename });
    }
  }
  return selected ? { status: 'found', profile: selected.sd, filename: selected.filename } : { status: 'absent' };
}

async function readFallbackReference(
  directory: string, canonical: string, family: FhirVersionFamily, owner?: ProfileReferenceCaptureOwner, expectedBoundary?: string, identityOnly = false,
): Promise<PackageReference> {
  const inventory = await capture('profile-reference-fallback-inventory', directory, () => readFallbackInventory(directory), owner);
  if (inventory.status === 'unavailable') return inventory;
  if (expectedBoundary !== undefined && inventory.boundary !== expectedBoundary) return { status: 'unavailable', cause: 'source-changed' };
  let selected: ProfileDescriptor | null = null;
  for (const candidate of inventory.profiles) {
    if (matchesReferenceIdentity(candidate.sd, canonical, family, identityOnly)) selected = selectBetterUnversionedProfile(selected, candidate);
  }
  if (!selected) return { status: 'absent' };
  const descriptor = selected;
  // Retain compact identities, then verify the chosen bytes against the scan before returning the full definition.
  return captureValidationDependency('profile', 'profile-reference-fallback-definition',
    [path.resolve(directory), inventory.boundary, descriptor.filename, descriptor.sha256], async () => {
      const result = await readProfileFileResult(directory, descriptor.filename, inventory.boundary);
      if (result.status === 'unavailable') return result;
      if (result.status !== 'read' || result.sha256 !== descriptor.sha256) return { status: 'unavailable', cause: 'source-changed' };
      return { status: 'found', profile: result.profile, filename: descriptor.filename };
    }, owner?.reuseScope, owner?.currentScope);
}

async function readExampleDirectory(directory: string): Promise<{ status: 'found'; directory: string; rootBoundary: string; boundary: string }
  | { status: 'absent' } | { status: 'unavailable'; cause: string }> {
  const folder = path.join(directory, 'example');
  try {
    if (!(await fs.stat(folder)).isDirectory()) return { status: 'unavailable', cause: 'package-unreadable' };
    const boundary = await fs.realpath(directory), example = await fs.realpath(folder);
    const relative = path.relative(boundary, example);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { status: 'unavailable', cause: 'unsafe-file' };
    }
    return { status: 'found', directory: folder, rootBoundary: boundary, boundary: example };
  } catch (error: unknown) {
    return isRecord(error) && error.code === 'ENOENT' ? { status: 'absent' }
      : { status: 'unavailable', cause: 'package-unreadable' };
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function matchesBoundary(directory: string, expected: string): Promise<boolean> {
  try { return await fs.realpath(directory) === expected; } catch { return false; }
}

/** An incompatible package can still own this identity; that is refusal evidence, never usable authority. */
function matchesReferenceIdentity(profile: ProfileIdentity, canonical: string, family: FhirVersionFamily, identityOnly: boolean): boolean {
  return profileMatchesCanonical(identityOnly ? { ...profile, fhirVersion: undefined } : profile, canonical, family);
}
