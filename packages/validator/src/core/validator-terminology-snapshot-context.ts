import type { ValidationSettings } from '@records-fhir/validation-types';
import { getProfileSource, type ProfileSourceContext } from '../persistence/index.js';
import { isRecord } from './fhir-resource.js';

interface SourceOptions {
  organizationId?: number; serverId?: number; fhirVersion?: 'R4' | 'R5' | 'R6'; settings?: unknown;
}

/** Every nested execution boundary carries the same immutable terminology identity. */
export function createValidationSourceContext(options: SourceOptions): ProfileSourceContext {
  const settings = isRecord(options.settings) ? options.settings : undefined;
  const resolution = isRecord(settings?.terminologyResolution) ? settings.terminologyResolution : undefined;
  const snapshot = resolution?.snapshot;
  const sha256 = isRecord(snapshot) ? snapshot.sha256 : undefined;
  if (snapshot !== undefined && (typeof sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(sha256))) throw new Error('Invalid terminology snapshot identity');
  return { organizationId: options.organizationId, serverId: options.serverId, fhirVersion: options.fhirVersion ?? 'R4',
    ...(typeof sha256 === 'string' ? { terminologySnapshotSha256: sha256 } : {}) };
}

/** Admission and source identity must be established before any terminology cache is consulted. */
export async function resolveTerminologySourceContext(options: SourceOptions): Promise<ProfileSourceContext> {
  const settings = options.settings as ValidationSettings | undefined;
  const context = createValidationSourceContext(options);
  if (settings?.terminologyResolution?.snapshot) {
    const source = getProfileSource();
    if (!source.assertTerminologySnapshot) throw new Error('The host does not support immutable terminology snapshots');
    await source.assertTerminologySnapshot(settings, context);
  }
  return context;
}
