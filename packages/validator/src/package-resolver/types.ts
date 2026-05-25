export interface PinnedCanonical {
  url: string;
  version: string;
  sourcePackage: string;
  resolvedBy: 'status-active' | 'terminology-priority' | 'core-priority' | 'version-highest' | 'override-pin' | 'only-candidate';
}

export interface CanonicalCandidate {
  url: string;
  version: string;
  sourcePackage: string;
  status?: 'active' | 'draft' | 'retired' | 'unknown';
  content?: string;
  hasExpansion?: boolean;
}

export interface LockFile {
  version: 1;
  generatedAt: string;
  generatedBy: string;
  algorithm: 'community-standard-v1';
  packages: string[];
  pinnedCanonicals: Record<string, PinnedCanonical>;
  treeShakenCount: number;
  totalCanonicals: number;
  retainedCanonicals: number;
  overrides: PinOverride[];
}

export type PinOverrideAction = 'skip' | 'pin' | 'replace';

export interface PinOverride {
  action: PinOverrideAction;
  package?: string;
  canonical?: string;
  version?: string;
  replaceWith?: string;
}

export type VersionAlgorithm = 'semver' | 'integer' | 'date' | 'alphabetic';
