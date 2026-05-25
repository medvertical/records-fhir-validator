/**
 * Canonical Pinner
 *
 * Resolves unversioned canonical references to explicit `url|version`
 * pairs using the community-standard 4-stage candidate selection
 * algorithm (finalized at FHIR Camp 2025 with Grahame Grieve, Gino
 * Canessa, and Lloyd McKenzie).
 *
 * Inputs: a set of installed packages, each containing canonical
 * resources (StructureDefinition, ValueSet, CodeSystem, etc.).
 * Output: a deterministic map of `url|version` → PinnedCanonical.
 */

import type { PinnedCanonical, CanonicalCandidate, PinOverride } from './types';
import { compareVersions, detectVersionAlgorithm } from './version-comparator';

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  draft: 1,
  retired: 2,
  unknown: 3,
};

const EXAMPLE_PACKAGE_PATTERN = /\.examples$/;
const COREXML_PACKAGE_PATTERN = /\.corexml$/;

function isExcluded(candidate: CanonicalCandidate): boolean {
  if (candidate.hasExpansion) return true;
  if (EXAMPLE_PACKAGE_PATTERN.test(candidate.sourcePackage)) return true;
  if (COREXML_PACKAGE_PATTERN.test(candidate.sourcePackage)) return true;
  if (candidate.content && candidate.content !== 'complete') return true;
  return false;
}

function isTerminologyPackage(pkg: string): boolean {
  return pkg.startsWith('hl7.terminology');
}

function isCorePackage(pkg: string): boolean {
  return /^hl7\.fhir\.\w+\.core/.test(pkg);
}

function selectCandidate(
  candidates: CanonicalCandidate[],
): { selected: CanonicalCandidate; resolvedBy: PinnedCanonical['resolvedBy'] } | null {
  const eligible = candidates.filter(c => !isExcluded(c));
  if (eligible.length === 0) return null;
  if (eligible.length === 1) {
    return { selected: eligible[0], resolvedBy: 'only-candidate' };
  }

  // Stage 1: Status — prefer active
  const byStatus = [...eligible].sort(
    (a, b) => (STATUS_PRIORITY[a.status || 'unknown'] ?? 3) - (STATUS_PRIORITY[b.status || 'unknown'] ?? 3),
  );
  const bestStatus = byStatus[0].status || 'unknown';
  const statusGroup = byStatus.filter(c => (c.status || 'unknown') === bestStatus);
  if (statusGroup.length === 1) {
    return { selected: statusGroup[0], resolvedBy: 'status-active' };
  }

  // Stage 2: Terminology package priority
  const termCandidates = statusGroup.filter(c => isTerminologyPackage(c.sourcePackage));
  if (termCandidates.length === 1) {
    return { selected: termCandidates[0], resolvedBy: 'terminology-priority' };
  }
  const pool2 = termCandidates.length > 0 ? termCandidates : statusGroup;

  // Stage 3: Core package priority
  const coreCandidates = pool2.filter(c => isCorePackage(c.sourcePackage));
  if (coreCandidates.length === 1) {
    return { selected: coreCandidates[0], resolvedBy: 'core-priority' };
  }
  const pool3 = coreCandidates.length > 0 ? coreCandidates : pool2;

  // Stage 4: Highest version
  const algo = detectVersionAlgorithm(pool3[0].version);
  const sorted = [...pool3].sort((a, b) => compareVersions(b.version, a.version, algo));
  return { selected: sorted[0], resolvedBy: 'version-highest' };
}

export function pinCanonicals(
  candidatesByUrl: Map<string, CanonicalCandidate[]>,
  overrides: PinOverride[] = [],
): Map<string, PinnedCanonical> {
  const pinned = new Map<string, PinnedCanonical>();

  // Apply skip overrides — remove entire packages from candidate pool
  const skippedPackages = new Set(
    overrides.filter(o => o.action === 'skip' && o.package).map(o => o.package!),
  );

  // Apply pin overrides first — these take precedence
  const pinOverrides = new Map<string, PinOverride>();
  for (const o of overrides) {
    if (o.action === 'pin' && o.canonical && o.version) {
      pinOverrides.set(o.canonical, o);
    }
  }

  // Apply replace overrides
  const replaceMap = new Map<string, string>();
  for (const o of overrides) {
    if (o.action === 'replace' && o.canonical && o.replaceWith) {
      replaceMap.set(o.canonical, o.replaceWith);
    }
  }

  for (const [url, candidates] of candidatesByUrl) {
    // Check replace
    if (replaceMap.has(url)) {
      const replacement = replaceMap.get(url)!;
      const replacementCandidates = candidatesByUrl.get(replacement);
      if (replacementCandidates) {
        const result = selectCandidate(
          replacementCandidates.filter(c => !skippedPackages.has(c.sourcePackage)),
        );
        if (result) {
          pinned.set(`${url}|${result.selected.version}`, {
            url,
            version: result.selected.version,
            sourcePackage: result.selected.sourcePackage,
            resolvedBy: 'override-pin',
          });
        }
      }
      continue;
    }

    // Check explicit pin
    const pinOverride = pinOverrides.get(url);
    if (pinOverride) {
      const match = candidates.find(c => c.version === pinOverride.version);
      if (match) {
        pinned.set(`${url}|${match.version}`, {
          url,
          version: match.version,
          sourcePackage: match.sourcePackage,
          resolvedBy: 'override-pin',
        });
        continue;
      }
    }

    // Standard 4-stage selection
    const filtered = candidates.filter(c => !skippedPackages.has(c.sourcePackage));
    const result = selectCandidate(filtered);
    if (result) {
      pinned.set(`${url}|${result.selected.version}`, {
        url,
        version: result.selected.version,
        sourcePackage: result.selected.sourcePackage,
        resolvedBy: result.resolvedBy,
      });
    }
  }

  return pinned;
}
