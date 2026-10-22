import { AsyncLocalStorage } from 'node:async_hooks';
import { getProfileSource, getProfileSourceRevision, type ProfileSource, type ProfileSourceContext } from '../persistence/index.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import { recordSnapshotExecutionFailure } from '../core/snapshot-profile-checks.js';

export interface TerminologySourceSnapshot {
  readonly context: Readonly<ProfileSourceContext> | undefined;
  readonly source: ProfileSource;
  readonly sourceRevision: number;
  readonly resolutionRevision: number;
  readonly packageDirectories: readonly string[] | undefined;
}

/** One terminology graph owns its bound default and its asynchronous request snapshots. */
export class TerminologySourceContexts {
  private readonly active = new AsyncLocalStorage<TerminologySourceSnapshot>();
  private resolutionRevision = 0;
  advanceResolutionRevision(): void { this.resolutionRevision++; }

  private boundContext: Readonly<ProfileSourceContext> | undefined;

  set(context: ProfileSourceContext | undefined): boolean {
    const next = context ? Object.freeze({ ...context }) : undefined;
    const changed = JSON.stringify(next) !== JSON.stringify(this.boundContext);
    this.boundContext = next;
    return changed;
  }

  current(): TerminologySourceSnapshot | undefined { return this.active.getStore(); }

  context(): Readonly<ProfileSourceContext> | undefined {
    const snapshot = this.current();
    return snapshot ? snapshot.context : this.boundContext;
  }

  run<T>(fhirVersion: FhirVersion | undefined, run: () => T): T {
    const parent = this.current();
    if (parent?.context?.terminologySnapshotSha256 && fhirVersion && parent.context.fhirVersion !== fhirVersion) {
      rejectSnapshotScopeChange(parent.context);
    }
    if (parent && (!fhirVersion || parent.context?.fhirVersion === fhirVersion)) return run();
    const context = parent?.context ?? this.boundContext;
    return this.active.run(Object.freeze({
      context: context || fhirVersion ? Object.freeze({ ...context, ...(fhirVersion ? { fhirVersion } : {}) }) : undefined,
      ...this.sourceSnapshot(parent),
    }), run);
  }

  runWith<T>(context: ProfileSourceContext | undefined, run: () => T): T {
    const parent = this.current();
    const bound = parent?.context;
    if (bound?.terminologySnapshotSha256 && (context?.terminologySnapshotSha256 !== bound.terminologySnapshotSha256
      || context?.organizationId !== bound.organizationId || context?.serverId !== bound.serverId
      || context?.fhirVersion !== bound.fhirVersion)) {
      rejectSnapshotScopeChange(bound);
    }
    if (parent && JSON.stringify(context) === JSON.stringify(parent.context)) return run();
    return this.active.run(Object.freeze({
      context: context ? Object.freeze({ ...context }) : undefined,
      ...this.sourceSnapshot(parent),
    }), run);
  }

  private sourceSnapshot(parent?: TerminologySourceSnapshot) {
    const source = parent?.source ?? getProfileSource();
    return {
      source, sourceRevision: parent?.sourceRevision ?? getProfileSourceRevision(),
      resolutionRevision: parent?.resolutionRevision ?? this.resolutionRevision,
      packageDirectories: parent ? parent.packageDirectories
        : source.packageDirectories ? Object.freeze([...source.packageDirectories]) : undefined,
    };
  }

  permitsPlainCache(): boolean {
    const snapshot = this.current();
    return !snapshot || (snapshot.context?.organizationId === undefined
      && !snapshot.source.findCanonicalResource);
  }

  key(key: string): string {
    const snapshot = this.current();
    if (!snapshot) return key;
    const context = snapshot.context;
    return JSON.stringify([snapshot.sourceRevision, snapshot.resolutionRevision, context?.organizationId ?? null,
      context?.serverId ?? null, context?.fhirVersion ?? null, context?.terminologySnapshotSha256 ?? null]) + ':' + key;
  }
}

function rejectSnapshotScopeChange(context: ProfileSourceContext): never {
  const error = Object.assign(new Error('Immutable terminology snapshot scope cannot change during validation'),
    { code: 'TERMINOLOGY_SNAPSHOT_SCOPE_CHANGED' });
  recordSnapshotExecutionFailure(error, context);
  throw error;
}
