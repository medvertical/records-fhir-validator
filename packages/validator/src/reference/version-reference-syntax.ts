import { parseReference } from './reference-type-extractor.js';
import { isCanonicalResourceType } from './canonical-reference-definitions.js';
import type {
  VersionConsistencyCheckResult,
  VersionedReferenceInfo,
  VersionIntegrityCheckResult,
} from './version-specific-reference-types.js';

const VERSIONED_REFERENCE_PATTERN = /^(.+)\/_history\/([^/]+)$/;
const VERSION_ID_PATTERN = /^[0-9]+$/;

export function parseVersionedReference(reference: string): VersionedReferenceInfo {
  const trimmed = reference.trim();
  const canonicalSeparator = trimmed.indexOf('|');
  if (canonicalSeparator >= 0) {
    const baseUrl = trimmed.slice(0, canonicalSeparator);
    const rawVersion = trimmed.slice(canonicalSeparator + 1);
    const versionId = rawVersion.trim();
    const parseResult = parseReference(baseUrl);
    return {
      reference: trimmed,
      resourceType: parseResult.resourceType ?? undefined,
      resourceId: parseResult.resourceId ?? undefined,
      versionId,
      isVersioned: true,
      isValidVersionFormat: versionId.length > 0 && !rawVersion.includes('|'),
    };
  }

  const historyMatch = trimmed.match(VERSIONED_REFERENCE_PATTERN);
  if (historyMatch) {
    const baseParseResult = parseReference(historyMatch[1]);
    return {
      reference: trimmed,
      resourceType: baseParseResult.resourceType ?? undefined,
      resourceId: baseParseResult.resourceId ?? undefined,
      versionId: historyMatch[2],
      isVersioned: true,
      isValidVersionFormat: isValidVersionId(historyMatch[2]),
    };
  }

  const parseResult = parseReference(trimmed);
  return {
    reference: trimmed,
    resourceType: parseResult.resourceType ?? undefined,
    resourceId: parseResult.resourceId ?? undefined,
    isVersioned: false,
    isValidVersionFormat: false,
  };
}

export function validateVersionedReference(reference: string): VersionIntegrityCheckResult {
  const versionInfo = parseVersionedReference(reference);
  if (!versionInfo.isVersioned) {
    return { isValid: true, severity: 'info', message: 'Reference is not versioned', versionInfo };
  }
  if (!versionInfo.isValidVersionFormat) {
    return {
      isValid: false,
      severity: 'error',
      message: `Invalid version format: '${versionInfo.versionId}'`,
      versionInfo,
      details: {
        expectedFormat: reference.includes('|')
          ? 'Non-empty canonical version without additional pipe separators'
          : 'Numeric version ID for _history references',
      },
    };
  }
  if (!versionInfo.resourceType || !versionInfo.resourceId) {
    return {
      isValid: false,
      severity: 'error',
      message: 'Versioned reference missing resource type or ID',
      versionInfo,
    };
  }
  return {
    isValid: true,
    severity: 'info',
    message: `Valid versioned reference: ${versionInfo.resourceType}/${versionInfo.resourceId}/_history/${versionInfo.versionId}`,
    versionInfo,
  };
}

export function checkVersionConsistency(references: string[]): VersionConsistencyCheckResult {
  const issues: VersionConsistencyCheckResult['issues'] = [];
  const referenceMap = new Map<string, VersionedReferenceInfo[]>();
  for (const reference of references) {
    const info = parseVersionedReference(reference);
    if (!info.resourceType || !info.resourceId) continue;
    const key = `${info.resourceType}/${info.resourceId}`;
    referenceMap.set(key, [...(referenceMap.get(key) ?? []), info]);
  }

  for (const [resourceKey, infos] of referenceMap) {
    const versioned = infos.filter((info) => info.isVersioned);
    const nonVersioned = infos.filter((info) => !info.isVersioned);
    if (versioned.length > 0 && nonVersioned.length > 0) {
      issues.push({
        reference1: versioned[0].reference,
        reference2: nonVersioned[0].reference,
        issue: `Resource ${resourceKey} has both versioned and non-versioned references`,
        severity: 'warning',
      });
    }
    const versionIds = new Set(versioned.map((info) => info.versionId).filter(Boolean));
    if (versionIds.size > 1) {
      issues.push({
        reference1: versioned[0].reference,
        reference2: versioned[1].reference,
        issue: `Resource ${resourceKey} referenced with different versions: ${Array.from(versionIds).join(', ')}`,
        severity: 'warning',
      });
    }
  }
  return { isConsistent: issues.length === 0, issues };
}

export function compareReferenceVersions(version1: string, version2: string): number {
  if (!isValidVersionId(version1) || !isValidVersionId(version2)) {
    return version1.localeCompare(version2);
  }
  const left = BigInt(version1);
  const right = BigInt(version2);
  return left === right ? 0 : left > right ? 1 : -1;
}

export function getLatestVersion(references: string[]): VersionedReferenceInfo | null {
  const versioned = references
    .map(parseVersionedReference)
    .filter((info): info is VersionedReferenceInfo & { versionId: string } => info.isVersioned && Boolean(info.versionId));
  if (versioned.length === 0) return null;
  return versioned.reduce((latest, current) =>
    compareReferenceVersions(current.versionId, latest.versionId) > 0 ? current : latest,
  );
}

export function toVersionedReference(reference: string, versionId: string): string {
  const unversioned = stripReferenceVersion(reference);
  const parseResult = parseReference(unversioned);
  if (
    parseResult.referenceType === 'canonical'
    || (parseResult.resourceType !== null
      && isCanonicalResourceType(parseResult.resourceType))
  ) {
    return `${unversioned}|${versionId}`;
  }
  if (parseResult.referenceType === 'absolute') {
    const url = new URL(unversioned);
    url.search = '';
    url.hash = '';
    return `${url.toString().replace(/\/$/, '')}/_history/${versionId}`;
  }
  if (parseResult.referenceType === 'relative' && parseResult.resourceType && parseResult.resourceId) {
    return `${parseResult.resourceType}/${parseResult.resourceId}/_history/${versionId}`;
  }
  return reference;
}

export function stripReferenceVersion(reference: string): string {
  const trimmed = reference.trim();
  const canonicalSeparator = trimmed.indexOf('|');
  if (canonicalSeparator >= 0) return trimmed.slice(0, canonicalSeparator);
  return trimmed.replace(VERSIONED_REFERENCE_PATTERN, '$1');
}

function isValidVersionId(versionId: string): boolean {
  return VERSION_ID_PATTERN.test(versionId);
}
