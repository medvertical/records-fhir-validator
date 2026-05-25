import type { VersionAlgorithm } from './types';

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.+-]+))?$/;
const INTEGER_REGEX = /^\d{6,}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function detectVersionAlgorithm(version: string): VersionAlgorithm {
  if (SEMVER_REGEX.test(version)) return 'semver';
  if (INTEGER_REGEX.test(version)) return 'integer';
  if (DATE_REGEX.test(version)) return 'date';
  return 'alphabetic';
}

export function compareVersions(a: string, b: string, algorithm?: VersionAlgorithm): number {
  const algo = algorithm ?? detectVersionAlgorithm(a);

  switch (algo) {
    case 'semver':
      return compareSemver(a, b);
    case 'integer':
      return Number(a) - Number(b);
    case 'date':
      return new Date(a).getTime() - new Date(b).getTime();
    case 'alphabetic':
      return a.localeCompare(b);
  }
}

function compareSemver(a: string, b: string): number {
  const matchA = a.match(SEMVER_REGEX);
  const matchB = b.match(SEMVER_REGEX);

  if (!matchA || !matchB) return a.localeCompare(b);

  const major = Number(matchA[1]) - Number(matchB[1]);
  if (major !== 0) return major;

  const minor = Number(matchA[2]) - Number(matchB[2]);
  if (minor !== 0) return minor;

  const patch = Number(matchA[3]) - Number(matchB[3]);
  if (patch !== 0) return patch;

  // Pre-release: absent > present (4.0.1 > 4.0.1-alpha)
  if (!matchA[4] && matchB[4]) return 1;
  if (matchA[4] && !matchB[4]) return -1;
  if (matchA[4] && matchB[4]) return matchA[4].localeCompare(matchB[4]);

  return 0;
}

export function selectHighestVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  if (versions.length === 1) return versions[0];

  const algo = detectVersionAlgorithm(versions[0]);
  return [...versions].sort((a, b) => compareVersions(b, a, algo))[0];
}
