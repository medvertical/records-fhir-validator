export type CustomRuleSelectedRelease = 'R4' | 'R4B' | 'R5' | 'R6';

export interface CustomRuleApplicabilityBasis {
  selectedRelease?: CustomRuleSelectedRelease | null;
  engineVersion?: 'R4' | 'R5' | 'R6' | null;
  /** Only the StructureDefinition actually loaded for this resource is evidence. */
  profile?: { canonical: string; version?: string | null } | null;
  profileResolutionFallback?: boolean;
}

export type CustomRuleApplicabilityReason =
  | 'restrictions-satisfied' | 'release-mismatch' | 'profile-mismatch'
  | 'malformed-restrictions' | 'release-basis-unavailable' | 'profile-basis-unavailable' | 'release-model-mismatch';

export interface CustomRuleApplicabilityResult {
  status: 'applicable' | 'not-applicable' | 'unknown';
  reason: CustomRuleApplicabilityReason;
}

export function normalizeCustomRuleSelectedRelease(value: unknown): CustomRuleSelectedRelease | null {
  if (typeof value !== 'string') return null;
  const version = value.trim().toUpperCase();
  if (version === 'R4' || /^4\.0\.\d+(?:[-+].*)?$/.test(version)) return 'R4';
  if (version === 'R4B' || /^4\.3\.\d+(?:[-+].*)?$/.test(version)) return 'R4B';
  if (version === 'R5' || /^5\.\d+\.\d+(?:[-+].*)?$/.test(version)) return 'R5';
  if (version === 'R6' || /^6\.\d+\.\d+(?:[-+].*)?$/.test(version)) return 'R6';
  return null;
}

export function isCustomRuleReleaseModelCoherent(selectedRelease: unknown, engineVersion: unknown): boolean {
  if (selectedRelease === null || selectedRelease === undefined) return true;
  const release = normalizeCustomRuleSelectedRelease(selectedRelease);
  return release !== null && engineVersion === (release === 'R4B' ? 'R4' : release);
}

function readSelectors(value: unknown, max: number, valid: (item: string) => boolean): readonly string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  for (let index = 0; index < value.length; index++) {
    if (typeof value[index] !== 'string' || !valid(value[index])) return null;
  }
  return value;
}

function isCanonicalSelector(value: string): boolean {
  if (!value || value.length > 2000 || value !== value.trim()) return false;
  const [canonical, version, extra] = value.split('|');
  if (extra !== undefined || version === '' || (version !== undefined && version !== version.trim())) return false;
  try {
    return ['http:', 'https:', 'urn:'].includes(new URL(canonical).protocol);
  } catch { return false; }
}

export function evaluateCustomRuleApplicability(
  rule: { fhirVersions?: unknown; profilesAny?: unknown },
  basis: CustomRuleApplicabilityBasis,
): CustomRuleApplicabilityResult {
  const releases = readSelectors(rule.fhirVersions, 4, item => ['R4', 'R4B', 'R5', 'R6'].includes(item));
  const profiles = rule.profilesAny === null ? null : readSelectors(rule.profilesAny, 50, isCanonicalSelector);
  if (!releases || !profiles) return { status: 'unknown', reason: 'malformed-restrictions' };
  if (basis.engineVersion !== undefined && !isCustomRuleReleaseModelCoherent(basis.selectedRelease, basis.engineVersion)) {
    return { status: 'unknown', reason: 'release-model-mismatch' };
  }
  let unknown: CustomRuleApplicabilityReason | undefined;
  if (releases.length) {
    const release = normalizeCustomRuleSelectedRelease(basis.selectedRelease);
    if (!release) unknown = 'release-basis-unavailable';
    else if (!releases.includes(release)) return { status: 'not-applicable', reason: 'release-mismatch' };
  }
  if (profiles.length) {
    const profile = basis.profile;
    if (!profile || !isCanonicalSelector(profile.canonical) || profile.canonical.includes('|')) {
      unknown ??= 'profile-basis-unavailable';
    } else {
      let missingVersion = false;
      const matches = profiles.some(selector => {
        const [canonical, version] = selector.split('|');
        if (canonical !== profile.canonical) return false;
        if (version === undefined) return true;
        if (typeof profile.version !== 'string' || !profile.version.trim()) missingVersion = true;
        return version === profile.version;
      });
      const unresolvedSelector = basis.profileResolutionFallback
        && profiles.some(selector => selector.split('|')[0] !== profile.canonical);
      if (!matches && !missingVersion && !unresolvedSelector) return { status: 'not-applicable', reason: 'profile-mismatch' };
      if (!matches) unknown ??= 'profile-basis-unavailable';
    }
  }
  return unknown ? { status: 'unknown', reason: unknown } : { status: 'applicable', reason: 'restrictions-satisfied' };
}
