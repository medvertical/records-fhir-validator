import { copyNestedElementProfileSources } from './element-profile-reference-provenance.js';
import { parsePackageDirName, type PackageRef } from './canonical-pin-store.js';

interface ProfileIdentity {
  url?: string;
  version?: string;
}

interface ProfilePackageOrigin {
  readonly url: string;
  readonly version: string | undefined;
  readonly packageRef: PackageRef;
  readonly packageDirectory?: string;
}

// A symbol survives the shallow profile snapshots used by validation callers,
// while JSON serialization keeps host/DB profiles free of installed provenance.
const profilePackageOrigin = Symbol('profilePackageOrigin');
const issuedOrigins = new WeakSet<ProfilePackageOrigin>();

interface ProvenanceCarrier {
  [profilePackageOrigin]?: unknown;
}

export function recordProfilePackageProvenance(
  profile: ProfileIdentity,
  packageDirName: string,
  packageDirectory?: string,
): void {
  if (!profile.url) return;
  const packageRef = parsePackageDirName(packageDirName);
  if (!packageRef) return;
  const origin: ProfilePackageOrigin = Object.freeze({
    url: profile.url,
    version: profile.version,
    packageRef: Object.freeze(packageRef),
    ...(packageDirectory ? { packageDirectory } : {}),
  });
  issuedOrigins.add(origin);
  Object.defineProperty(profile, profilePackageOrigin, {
    value: origin, enumerable: true, configurable: true,
  });
}

function issuedProfileOrigin(profile: ProfileIdentity): ProfilePackageOrigin | null {
  const origin = (profile as ProfileIdentity & ProvenanceCarrier)[profilePackageOrigin];
  if (typeof origin !== 'object' || origin === null || !issuedOrigins.has(origin as ProfilePackageOrigin)) {
    return null;
  }
  const issued = origin as ProfilePackageOrigin;
  // A caller can copy a profile then change its identity; the copy must not
  // assign the original package to a different canonical or business version.
  return issued.url === profile.url && issued.version === profile.version ? issued : null;
}

export function lookupProfilePackageProvenance(profile: ProfileIdentity): PackageRef | null {
  return issuedProfileOrigin(profile)?.packageRef ?? null;
}

export function lookupProfilePackageDirectory(profile: ProfileIdentity): string | undefined {
  return issuedProfileOrigin(profile)?.packageDirectory;
}

/** Detached dependency copies must retain issued authority without inferring it from FHIR content. */
export function copyProfilePackageProvenance(original: unknown, copy: unknown): void {
  if (!original || typeof original !== 'object' || Array.isArray(original)
    || !copy || typeof copy !== 'object' || Array.isArray(copy)) return;
  copyNestedElementProfileSources(original, copy);
  const issued = issuedProfileOrigin(original as ProfileIdentity);
  const identity = copy as ProfileIdentity;
  if (!issued || issued.url !== identity.url || issued.version !== identity.version) return;
  Object.defineProperty(copy, profilePackageOrigin, {
    value: issued, enumerable: true, configurable: true,
  });
}
