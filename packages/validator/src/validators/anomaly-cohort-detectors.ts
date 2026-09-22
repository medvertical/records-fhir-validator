import type { AnomalyDetectorConfig, AnomalyFinding } from './anomaly-types.js';
import {
  collectReferences,
  getPrimaryCode,
  getResourceId,
  getResourceType,
  getString,
  getSubjectReference,
  toRecord,
  type FhirRecord,
} from './anomaly-resource-utils.js';

interface ResourceEntry {
  index: number;
  resource: FhirRecord;
}

interface ObservationDuplicateGroup {
  subject: string;
  code: string;
  effective: string;
  entries: ResourceEntry[];
}

export function detectMissingFields(
  resources: unknown[],
  config: AnomalyDetectorConfig,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const byType = groupByType(resources);

  for (const [resourceType, group] of byType) {
    if (group.length < config.minBatchSize) continue;
    const fieldCounts = new Map<string, number>();
    for (const { resource } of group) {
      for (const [key, value] of Object.entries(resource)) {
        if (IGNORED_MISSING_FIELD_KEYS.has(key)) continue;
        if (value === undefined || value === null) continue;
        fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
      }
    }

    for (const [field, count] of fieldCounts) {
      const ratio = count / group.length;
      if (ratio < config.missingFieldThreshold || ratio >= 1) continue;
      const missing = group.filter(({ resource }) =>
        resource[field] === undefined || resource[field] === null
      );
      if (missing.length === 0) continue;

      const percentage = Math.round(ratio * 100);
      findings.push({
        type: 'missing-field',
        description:
          `${percentage}% of ${resourceType} resources have '${field}', ` +
          `but ${missing.length} are missing it. This is likely a ` +
          `data-quality issue rather than intentional omission.`,
        confidence: ratio,
        affectedIndices: missing.map(entry => entry.index),
        affectedIds: missing.map(entry =>
          getResourceId(entry.resource, entry.index)
        ),
        resourceType,
        fieldPath: `${resourceType}.${field}`,
        suggestion:
          `Review the ${missing.length} ${resourceType} resources missing '${field}'. ` +
          `If the field is expected, add it. If intentionally absent, consider ` +
          `adding a data-absent-reason extension.`,
        cohortCount: count,
        outlierCount: missing.length,
      });
    }
  }
  return findings;
}

export function detectDuplicates(resources: unknown[]): AnomalyFinding[] {
  return [
    ...detectDuplicateObservations(resources),
    ...detectDuplicateLogicalIds(resources),
  ];
}

function detectDuplicateObservations(resources: unknown[]): AnomalyFinding[] {
  const observations = groupByType(resources).get('Observation');
  if (!observations || observations.length < 2) return [];

  const groups = new Map<string, ObservationDuplicateGroup>();
  for (const entry of observations) {
    const subject = getSubjectReference(entry.resource);
    const code = getPrimaryCode(entry.resource);
    const effective = getObservationEffective(entry.resource) ?? '';
    if (!subject || !code) continue;

    const key = JSON.stringify([subject, code, effective]);
    const group = groups.get(key) ?? { subject, code, effective, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }

  return Array.from(groups.values()).flatMap(group => {
    if (group.entries.length < 2) return [];
    return [{
      type: 'duplicate-resource' as const,
      description:
        `${group.entries.length} Observations for subject '${group.subject}' with ` +
        `code '${group.code}'${group.effective ? ` at ${group.effective}` : ''} — ` +
        `probable duplicate import.`,
      confidence: 0.85,
      affectedIndices: group.entries.map(entry => entry.index),
      affectedIds: group.entries.map(entry =>
        getResourceId(entry.resource, entry.index)
      ),
      resourceType: 'Observation',
      suggestion:
        `Review and deduplicate. If these are intentional repeat measurements, ` +
        `consider using different effectiveDateTime values or adding a ` +
        `method/device discriminator.`,
      outlierCount: group.entries.length,
    }];
  });
}

function detectDuplicateLogicalIds(resources: unknown[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [resourceType, group] of groupByType(resources)) {
    const idGroups = new Map<string, ResourceEntry[]>();
    for (const entry of group) {
      const id = getString(entry.resource.id);
      if (!id) continue;
      const entries = idGroups.get(id) ?? [];
      entries.push(entry);
      idGroups.set(id, entries);
    }

    for (const [id, duplicates] of idGroups) {
      if (duplicates.length < 2) continue;
      findings.push({
        type: 'duplicate-resource',
        description:
          `${duplicates.length} ${resourceType} resources share id '${id}' — ` +
          `duplicate resources in the same batch.`,
        confidence: 0.95,
        affectedIndices: duplicates.map(entry => entry.index),
        affectedIds: duplicates.map(() => id),
        resourceType,
        suggestion: `Remove duplicate ${resourceType}/${id} entries from the batch.`,
        outlierCount: duplicates.length,
      });
    }
  }
  return findings;
}

export function detectOrphanReferences(resources: unknown[]): AnomalyFinding[] {
  const present = new Set<string>();
  for (const resource of resources) {
    const resourceType = getResourceType(resource);
    const id = getString(toRecord(resource)?.id);
    if (resourceType && id) present.add(`${resourceType}/${id}`);
  }
  if (present.size === 0) return [];

  const orphanSources = new Map<string, Set<number>>();
  for (let index = 0; index < resources.length; index++) {
    for (const reference of collectReferences(resources[index])) {
      if (!RELATIVE_REFERENCE_PATTERN.test(reference) || present.has(reference)) {
        continue;
      }
      const sources = orphanSources.get(reference) ?? new Set<number>();
      sources.add(index);
      orphanSources.set(reference, sources);
    }
  }

  const findings: AnomalyFinding[] = [];
  for (const [target, sourceSet] of orphanSources) {
    const sourceIndices = Array.from(sourceSet);
    if (sourceIndices.length < 2) continue;
    findings.push({
      type: 'orphan-reference',
      description:
        `${sourceIndices.length} resources reference '${target}' ` +
        `which is not present in this batch.`,
      confidence: 0.7,
      affectedIndices: sourceIndices,
      affectedIds: sourceIndices.map(index =>
        getResourceId(resources[index], index)
      ),
      resourceType: target.split('/')[0],
      suggestion:
        `Include '${target}' in the batch, or verify that the ` +
        `reference is intentionally external.`,
      outlierCount: sourceIndices.length,
    });
  }
  return findings;
}

function groupByType(resources: unknown[]): Map<string, ResourceEntry[]> {
  const groups = new Map<string, ResourceEntry[]>();
  for (let index = 0; index < resources.length; index++) {
    const resource = toRecord(resources[index]);
    const resourceType = getResourceType(resource);
    if (!resource || !resourceType) continue;
    const entries = groups.get(resourceType) ?? [];
    entries.push({ index, resource });
    groups.set(resourceType, entries);
  }
  return groups;
}

function getObservationEffective(resource: FhirRecord): string | undefined {
  return getString(resource.effectiveDateTime)
    ?? getString(toRecord(resource.effectivePeriod)?.start);
}

const IGNORED_MISSING_FIELD_KEYS = new Set([
  'resourceType',
  'id',
  'meta',
  'text',
]);

const RELATIVE_REFERENCE_PATTERN = /^[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]+$/;
