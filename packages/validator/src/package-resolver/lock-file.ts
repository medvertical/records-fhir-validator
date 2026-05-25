import type { LockFile, PinnedCanonical, PinOverride } from './types';

export function generateLockFile(
  pinned: Map<string, PinnedCanonical>,
  packages: string[],
  overrides: PinOverride[],
  totalBeforeShaking: number,
  appVersion: string,
): LockFile {
  const pinnedObj: Record<string, PinnedCanonical> = {};
  for (const [key, value] of pinned) {
    pinnedObj[key] = value;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: `Records ${appVersion}`,
    algorithm: 'community-standard-v1',
    packages: [...packages].sort(),
    pinnedCanonicals: pinnedObj,
    treeShakenCount: totalBeforeShaking - pinned.size,
    totalCanonicals: totalBeforeShaking,
    retainedCanonicals: pinned.size,
    overrides,
  };
}

export function lockFileHash(lockFile: LockFile): string {
  const { generatedAt: _, generatedBy: __, ...stable } = lockFile;
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update(JSON.stringify(stable))
    .digest('hex')
    .substring(0, 16);
}
