/**
 * Canonical Candidate Collector
 *
 * Walks a list of installed FHIR packages on disk and emits a
 * `CanonicalCandidate[]` per canonical URL. The result feeds
 * `pinCanonicals()` in `canonical-pinner.ts`, which picks one version
 * per URL deterministically; that pinned map is what
 * `generateLockFile()` serialises into `.records-lock.json`.
 *
 * Package layout — HL7 NPM convention:
 *
 *   <root>/<name>#<version>/package/<resourceType>-<id>.json
 *
 * Callers pass the package search roots explicitly. The first matching
 * `name#version` wins, so callers can put downloaded package caches
 * before bundled fallback packages.
 */

import fs from 'fs';
import path from 'path';
import type { CanonicalCandidate } from './types';

/**
 * Resource types whose `url` field is the canonical the validator
 * resolves at runtime. Everything else (Bundle, Patient, examples) is
 * skipped so we don't pollute the candidate map with non-canonical
 * resources.
 */
const CANONICAL_RESOURCE_TYPES = new Set([
  'StructureDefinition',
  'ValueSet',
  'CodeSystem',
  'ConceptMap',
  'NamingSystem',
  'SearchParameter',
  'OperationDefinition',
  'CapabilityStatement',
  'ImplementationGuide',
  'MessageDefinition',
  'GraphDefinition',
  'Questionnaire',
  'ActivityDefinition',
  'PlanDefinition',
  'Library',
  'Measure',
]);

const VALID_STATUS = new Set(['active', 'draft', 'retired', 'unknown']);

export interface CollectorOptions {
  /** Package search root list in priority order. */
  searchPaths: string[];
  /** When set, the collector skips packages it cannot find on disk silently. */
  skipMissing?: boolean;
}

export interface CollectorResult {
  candidatesByUrl: Map<string, CanonicalCandidate[]>;
  /** Total number of candidate entries (sum across all URLs) before any pinning. */
  totalCandidates: number;
  /** Packages that were requested but could not be located on disk. */
  missingPackages: string[];
  /** Packages that were located but contained no canonical resources. */
  emptyPackages: string[];
}

/**
 * Resolve `name#version` to an absolute package directory under one of
 * the configured search roots. Returns `null` if no root contains the
 * package.
 */
function resolvePackageDir(packageId: string, searchPaths: string[]): string | null {
  for (const root of searchPaths) {
    const candidate = path.join(root, packageId, 'package');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    // Some packages place the resources at the root, not under `package/`.
    const flat = path.join(root, packageId);
    if (fs.existsSync(flat) && fs.statSync(flat).isDirectory()) {
      const flatHasPackageJson = fs.existsSync(path.join(flat, 'package.json'));
      if (flatHasPackageJson) return flat;
    }
  }
  return null;
}

/** Read one JSON file and emit a CanonicalCandidate if it carries a canonical URL. */
function readCandidate(filePath: string, sourcePackage: string): CanonicalCandidate | null {
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rt = parsed.resourceType;
  if (typeof rt !== 'string' || !CANONICAL_RESOURCE_TYPES.has(rt)) return null;
  const url = parsed.url;
  const version = parsed.version;
  if (typeof url !== 'string' || typeof version !== 'string') return null;

  const status = typeof parsed.status === 'string' && VALID_STATUS.has(parsed.status)
    ? (parsed.status as CanonicalCandidate['status'])
    : 'unknown';

  const result: CanonicalCandidate = {
    url,
    version,
    sourcePackage,
    status,
  };
  if (typeof parsed.content === 'string') result.content = parsed.content;
  if (parsed.expansion && typeof parsed.expansion === 'object') result.hasExpansion = true;
  return result;
}

/**
 * Walk the given `package/` directory non-recursively (HL7 NPM
 * convention places all resources at the top level) and collect
 * canonical candidates. Returns the candidates plus a flag indicating
 * whether the package contributed any.
 */
function collectFromPackageDir(
  dir: string,
  sourcePackage: string,
): { candidates: CanonicalCandidate[]; nonEmpty: boolean } {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { candidates: [], nonEmpty: false };
  }

  const candidates: CanonicalCandidate[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    if (entry === 'package.json' || entry === '.index.json') continue;
    const full = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const candidate = readCandidate(full, sourcePackage);
    if (candidate) candidates.push(candidate);
  }

  return { candidates, nonEmpty: candidates.length > 0 };
}

/**
 * Top-level collector. Given a list of `name#version` package ids,
 * returns the candidate map ready for `pinCanonicals()`.
 */
export function collectCanonicalCandidates(
  packages: string[],
  options: CollectorOptions,
): CollectorResult {
  const searchPaths = options.searchPaths;
  const candidatesByUrl = new Map<string, CanonicalCandidate[]>();
  const missingPackages: string[] = [];
  const emptyPackages: string[] = [];
  let totalCandidates = 0;

  for (const pkg of packages) {
    const dir = resolvePackageDir(pkg, searchPaths);
    if (!dir) {
      missingPackages.push(pkg);
      continue;
    }

    const { candidates, nonEmpty } = collectFromPackageDir(dir, pkg);
    if (!nonEmpty) {
      emptyPackages.push(pkg);
      continue;
    }

    for (const c of candidates) {
      const list = candidatesByUrl.get(c.url) ?? [];
      list.push(c);
      candidatesByUrl.set(c.url, list);
      totalCandidates++;
    }
  }

  return { candidatesByUrl, totalCandidates, missingPackages, emptyPackages };
}
