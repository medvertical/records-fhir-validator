import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import type { UnverifiedBindingDiagnostic } from '../issues/unverified-binding-diagnostic.js';
import { EpochSingleflight } from './epoch-singleflight.js';
import { createEmptyTerminologyDiagnostics } from './valueset-diagnostics.js';
import {
  cloneTerminologyResolutionConfig,
  mergeTerminologyResolutionConfig,
} from './valueset-resolution-config.js';
import {
  DEFAULT_RESOLUTION_CONFIG,
  type CodeBindingOutcome,
  type TerminologyDiagnostics,
  type TerminologyResolutionConfig,
} from './valueset-types.js';

/** Owns mutable ValueSet resolution state independently from runtime components. */
export class ValueSetRuntimeState {
  private currentResolutionConfig = cloneTerminologyResolutionConfig(
    DEFAULT_RESOLUTION_CONFIG,
  );
  private currentTerminologyDiagnostics = createEmptyTerminologyDiagnostics();

  readonly bindingResolutions = new EpochSingleflight<CodeBindingOutcome>();

  /**
   * Why recent bindings stayed unverified, keyed by binding identity. The
   * resolver only returns a tri-state outcome; the issue builder reads the
   * explanation from here when it reports the skip.
   */
  readonly unverifiedBindingDiagnostics = new BoundedLruCache<string, UnverifiedBindingDiagnostic>(2_048);

  get resolutionConfig(): TerminologyResolutionConfig {
    return this.currentResolutionConfig;
  }

  get terminologyDiagnostics(): TerminologyDiagnostics {
    return this.currentTerminologyDiagnostics;
  }

  updateResolutionConfig(
    config: Partial<TerminologyResolutionConfig>,
  ): TerminologyResolutionConfig {
    this.currentResolutionConfig = mergeTerminologyResolutionConfig(
      this.currentResolutionConfig,
      config,
    );
    return this.currentResolutionConfig;
  }

  getResolutionConfigSnapshot(): TerminologyResolutionConfig {
    return cloneTerminologyResolutionConfig(this.currentResolutionConfig);
  }

  advanceBindingResolutionEpoch(): void {
    this.bindingResolutions.advanceEpoch();
  }

  resetTerminologyDiagnostics(): void {
    this.currentTerminologyDiagnostics = createEmptyTerminologyDiagnostics();
    this.unverifiedBindingDiagnostics.clear();
  }
}
