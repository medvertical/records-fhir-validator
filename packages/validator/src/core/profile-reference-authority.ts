import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/issue-factory.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { type PackageRef } from '../package/canonical-pin-store.js';
import { dependencyClosureEntries } from '../package/canonical-pin-dependency-closure.js';
import { copyProfilePackageProvenance, lookupProfilePackageDirectory,
  lookupProfilePackageProvenance, recordProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { isPinExemptCanonical, sharedPinStore } from '../package/canonical-pin-context.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { captureValidationDependency, ValidationDependencySnapshotLimitError } from '../validation-dependency-snapshot.js';
import { readPackageReference, type ProfileReferenceCaptureOwner } from './profile-reference-package-inventory.js';
/** The profile whose content names the canonical being resolved. */
export interface ProfileReferenceSource {
  url?: string;
  version?: string;
}

export interface ProfileReferencePinScope {
  /** Package stores the profile loader reads, in precedence order. */
  storeDirs: readonly string[];
  /** Host package pins; a pinned package resolves only at its pinned release. */
  packageVersionPins: Readonly<Record<string, string>>;
}


export interface ProfileDependencyReceipt {
  canonical: string;
  source?: PackageRef;
  dependency?: PackageRef;
  cause: string;
}
export class ProfileReferenceUnavailableError extends Error {
  readonly receipt: Readonly<ProfileDependencyReceipt>;
  constructor(receipt: ProfileDependencyReceipt) {
    super('The selected profile dependency could not be verified.');
    this.name = 'ProfileReferenceUnavailableError';
    this.receipt = Object.freeze({ ...receipt,
      ...(receipt.source ? { source: Object.freeze({ ...receipt.source }) } : {}),
      ...(receipt.dependency ? { dependency: Object.freeze({ ...receipt.dependency }) } : {}) });
  }
}
export type ProfileReferenceAuthority =
  | { status: 'unscoped' | 'exhausted' }
  | { status: 'selected'; profile: StructureDefinition; packageDirectory: string; filename: string }
  | { status: 'unavailable'; receipt: ProfileDependencyReceipt };
const CORE_PACKAGE = /^hl7\.fhir\.r[456][ab]?\.(?:core|examples)$/i;
const selectedDefinition = new AsyncLocalStorage<{ profile: StructureDefinition; key: string; family: 'R4' | 'R5' | 'R6' }>();

/** Recursive conformance retains the already-read package definition instead of selecting globally again. */
export function withSelectedProfileDefinition<T>(profile: StructureDefinition, family: 'R4' | 'R5' | 'R6', run: () => T): T {
  const origin = lookupProfilePackageProvenance(profile);
  if (!origin) return selectedDefinition.exit(run);
  const copied = structuredClone(profile); copyProfilePackageProvenance(profile, copied);
  const key = createHash('sha256').update(JSON.stringify([origin, lookupProfilePackageDirectory(profile), copied])).digest('hex');
  return selectedDefinition.run({ profile: copied, key, family }, run);
}
export function selectedProfileLookup(url: string, family: 'R4' | 'R5' | 'R6') {
  const selected = selectedDefinition.getStore();
  if (!selected || selected.family !== family || !profileMatchesCanonical(selected.profile, url, family)) return undefined;
  const profile = structuredClone(selected.profile); copyProfilePackageProvenance(selected.profile, profile);
  return { ...selected, profile };
}

/** Unscoped host references keep their normal lookup policy and do not enter the implicit package inventory budget. */
export function profileReferenceHasPackageAuthority(canonical: string, source: ProfileReferenceSource | null | undefined): boolean {
  const origin = source && lookupProfilePackageProvenance(source);
  return Boolean(origin && !isPinExemptCanonical(canonical.split('|')[0]) && !CORE_PACKAGE.test(origin.name));
}

export async function resolveProfileReferenceAuthority(
  canonical: string, source: ProfileReferenceSource | null | undefined,
  scope: ProfileReferencePinScope, family: 'R4' | 'R5' | 'R6', owner?: ProfileReferenceCaptureOwner,
): Promise<ProfileReferenceAuthority> {
  const origin = source && lookupProfilePackageProvenance(source);
  if (!origin || !profileReferenceHasPackageAuthority(canonical, source)) return { status: 'unscoped' };
  const unavailable = (cause: string, dependency?: PackageRef): ProfileReferenceAuthority => ({
    status: 'unavailable', receipt: { canonical, source: origin, ...(dependency ? { dependency } : {}), cause },
  });
  try {
    const manifests = await captureValidationDependency('profile', 'profile-reference-installed-manifests', scope.storeDirs,
      () => sharedPinStore.listInstalledManifestCandidates(scope.storeDirs), owner?.reuseScope, owner?.currentScope);
    const sourceDirectory = lookupProfilePackageDirectory(source!);
    if (sourceDirectory) {
      const sourceRank = scope.storeDirs.findIndex(store => [path.join(store, `${origin.name}#${origin.version}`, 'package'),
        path.join(store, `${origin.name}#${origin.version}`)].some(candidate => path.resolve(candidate) === path.resolve(sourceDirectory)));
      const actual = manifests.find(manifest => manifest.storeRank === sourceRank
        && manifest.ref.name === origin.name && manifest.ref.version === origin.version
        && path.resolve(manifest.packageDirectory!) === path.resolve(sourceDirectory));
      if (!actual) return unavailable('source-missing');
      // An equal package ref in an earlier store does not own this issued profile.
      manifests.unshift(actual);
    }
    const entries = dependencyClosureEntries(manifests, origin, scope.packageVersionPins, name => CORE_PACKAGE.test(name));
    for (const entry of entries) {
      if (entry.status === 'unavailable') return unavailable(entry.cause, entry.ref);
      const manifest = entry.manifest;
      const versions = manifest.fhirVersions;
      const major = family.slice(1);
      const packageDirectory = manifest.ref.name === origin.name && manifest.ref.version === origin.version && sourceDirectory
        ? sourceDirectory : manifest.packageDirectory!;
      if (versions.length && !versions.some(version => version.startsWith(`${major}.`))) {
        const claim = await readPackageReference(packageDirectory, canonical, family, owner, true, undefined, true);
        if (claim.status === 'unavailable') return unavailable(claim.cause, manifest.ref);
        if (claim.status === 'found') return unavailable('dependency-fhir-version-incompatible', manifest.ref);
        continue;
      }
      const result = await readPackageReference(packageDirectory, canonical, family, owner);
      if (result.status === 'unavailable') return unavailable(result.cause, manifest.ref);
      if (result.status === 'absent') continue;
      recordProfilePackageProvenance(result.profile, `${manifest.ref.name}#${manifest.ref.version}`, packageDirectory);
      return { status: 'selected', profile: result.profile, packageDirectory, filename: result.filename };
    }
    return { status: 'exhausted' };
  } catch (error: unknown) {
    return unavailable(error instanceof ValidationDependencySnapshotLimitError ? 'dependency-snapshot-limit' : 'store-unreadable');
  }
}

export function profileDefinitionSourceKey(profile: StructureDefinition): string | undefined {
  const origin = lookupProfilePackageProvenance(profile);
  return origin ? createHash('sha256').update(JSON.stringify([origin, lookupProfilePackageDirectory(profile), profile])).digest('hex') : undefined;
}
/** Capture failures occur after resolution; preserve unavailable evidence at that outer boundary too. */
export function rethrowProfileReferenceCaptureFailure(error: unknown, canonical: string, source: ProfileReferenceSource | null | undefined): never {
  const origin = source && lookupProfilePackageProvenance(source);
  if (error instanceof ValidationDependencySnapshotLimitError) {
    throw new ProfileReferenceUnavailableError({ canonical, ...(origin ? { source: origin } : {}), cause: 'dependency-snapshot-limit' });
  }
  throw error;
}

export function profileReferenceUnavailableIssue(error: ProfileReferenceUnavailableError, path: string): ValidationIssue {
  return createValidationIssue({ code: 'profile-reference-unavailable', path, resourceType: path.split('.')[0],
    aspectOverride: 'profile', severityOverride: 'information', customMessage: error.message,
    details: { validationComplete: false, validationStatus: 'incomplete', ...error.receipt } });
}

const resolutionOwners = new WeakMap<object, number>();
let nextResolutionOwner = 0;
/** Private cache identity includes loader policy changes; it does not attest transitive content. */
export function profileResolutionOwnerKey(owner: object | undefined): string {
  if (!owner) return '';
  let key = resolutionOwners.get(owner);
  if (key === undefined) { key = ++nextResolutionOwner; resolutionOwners.set(owner, key); }
  return String(key);
}
