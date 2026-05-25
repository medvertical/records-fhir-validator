export { pinCanonicals } from './canonical-pinner';
export { treeShake, extractOutgoingRefs, type CanonicalGraph } from './tree-shaker';
export { generateLockFile, lockFileHash } from './lock-file';
export { detectVersionAlgorithm, compareVersions, selectHighestVersion } from './version-comparator';
export {
  collectCanonicalCandidates,
  type CollectorOptions,
  type CollectorResult,
} from './candidate-collector';
export type {
  PinnedCanonical,
  CanonicalCandidate,
  LockFile,
  PinOverride,
  PinOverrideAction,
  VersionAlgorithm,
} from './types';
