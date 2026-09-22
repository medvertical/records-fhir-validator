export { pinCanonicals } from './canonical-pinner.js';
export { treeShake, extractOutgoingRefs, type CanonicalGraph } from './tree-shaker.js';
export { generateLockFile, lockFileHash } from './lock-file.js';
export { detectVersionAlgorithm, compareVersions, selectHighestVersion } from './version-comparator.js';
export {
  collectCanonicalCandidates,
  type CollectorOptions,
  type CollectorResult,
} from './candidate-collector.js';
export type {
  PinnedCanonical,
  CanonicalCandidate,
  LockFile,
  PinOverride,
  PinOverrideAction,
  VersionAlgorithm,
} from './types.js';
