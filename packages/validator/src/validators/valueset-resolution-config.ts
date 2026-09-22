import type { TerminologyResolutionConfig } from './valueset-types.js';
import { snapshotTerminologyConfig } from './terminology-config-snapshot.js';

export function cloneTerminologyResolutionConfig(
  config: TerminologyResolutionConfig,
): TerminologyResolutionConfig {
  return snapshotTerminologyConfig(config);
}

export function mergeTerminologyResolutionConfig(
  current: TerminologyResolutionConfig,
  update: Partial<TerminologyResolutionConfig>,
): TerminologyResolutionConfig {
  return cloneTerminologyResolutionConfig({
    ...current,
    ...update,
    serverDelegation: update.serverDelegation === undefined
      ? current.serverDelegation
      : {
        ...current.serverDelegation,
        ...update.serverDelegation,
      },
  });
}
