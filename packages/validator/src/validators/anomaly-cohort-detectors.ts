import type { AnomalyDetectorConfig, AnomalyFinding } from './anomaly-types';

type ResourceEntry = { index: number; resource: any };

export function detectMissingFields(
  resources: any[],
  config: AnomalyDetectorConfig,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const byType = groupByType(resources);

  for (const [resourceType, group] of byType) {
    if (group.length < config.minBatchSize) continue;

    const fieldCounts = new Map<string, number>();
    for (const { resource } of group) {
      for (const key of Object.keys(resource)) {
        if (key === 'resourceType' || key === 'id' || key === 'meta' || key === 'text') continue;
        if (resource[key] === undefined || resource[key] === null) continue;
        fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
      }
    }

    for (const [field, count] of fieldCounts) {
      const ratio = count / group.length;
      if (ratio < config.missingFieldThreshold || ratio >= 1.0) continue;

      const missing = group.filter(g => {
        const v = g.resource[field];
        return v === undefined || v === null;
      });
      if (missing.length === 0) continue;

      const pct = Math.round(ratio * 100);
      findings.push({
        type: 'missing-field',
        description:
          `${pct}% of ${resourceType} resources have '${field}', ` +
          `but ${missing.length} are missing it. This is likely a ` +
          `data-quality issue rather than intentional omission.`,
        confidence: ratio,
        affectedIndices: missing.map(m => m.index),
        affectedIds: missing.map(m => m.resource.id || `[index ${m.index}]`),
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

export function detectDuplicates(resources: any[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const byType = groupByType(resources);

  const observations = byType.get('Observation');
  if (observations && observations.length >= 2) {
    const keyMap = new Map<string, ResourceEntry[]>();

    for (const entry of observations) {
      const r = entry.resource;
      const subject = r.subject?.reference || '';
      const code = r.code?.coding?.[0]?.code || r.code?.text || '';
      const effective = r.effectiveDateTime || r.effectivePeriod?.start || '';
      if (!subject || !code) continue;

      const key = `${subject}|${code}|${effective}`;
      if (!keyMap.has(key)) keyMap.set(key, []);
      keyMap.get(key)!.push(entry);
    }

    for (const [key, group] of keyMap) {
      if (group.length < 2) continue;
      const [subject, code, effective] = key.split('|');
      findings.push({
        type: 'duplicate-resource',
        description:
          `${group.length} Observations for subject '${subject}' with ` +
          `code '${code}'${effective ? ` at ${effective}` : ''} — ` +
          `probable duplicate import.`,
        confidence: 0.85,
        affectedIndices: group.map(g => g.index),
        affectedIds: group.map(g => g.resource.id || `[index ${g.index}]`),
        resourceType: 'Observation',
        suggestion:
          `Review and deduplicate. If these are intentional repeat ` +
          `measurements, consider using different effectiveDateTime values ` +
          `or adding a method/device discriminator.`,
        outlierCount: group.length,
      });
    }
  }

  for (const [resourceType, group] of byType) {
    const idMap = new Map<string, ResourceEntry[]>();
    for (const entry of group) {
      const id = entry.resource.id;
      if (!id) continue;
      if (!idMap.has(id)) idMap.set(id, []);
      idMap.get(id)!.push(entry);
    }
    for (const [id, dupes] of idMap) {
      if (dupes.length < 2) continue;
      findings.push({
        type: 'duplicate-resource',
        description:
          `${dupes.length} ${resourceType} resources share id '${id}' — ` +
          `duplicate resources in the same batch.`,
        confidence: 0.95,
        affectedIndices: dupes.map(d => d.index),
        affectedIds: dupes.map(() => id),
        resourceType,
        suggestion: `Remove duplicate ${resourceType}/${id} entries from the batch.`,
        outlierCount: dupes.length,
      });
    }
  }

  return findings;
}

export function detectOrphanReferences(resources: any[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  const present = new Set<string>();
  for (const r of resources) {
    if (r.resourceType && r.id) {
      present.add(`${r.resourceType}/${r.id}`);
    }
  }
  if (present.size === 0) return findings;

  const orphans = new Map<string, number[]>();

  for (let i = 0; i < resources.length; i++) {
    const refs = collectReferences(resources[i]);
    for (const ref of refs) {
      if (/^[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]+$/.test(ref) && !present.has(ref)) {
        if (!orphans.has(ref)) orphans.set(ref, []);
        orphans.get(ref)!.push(i);
      }
    }
  }

  for (const [target, sourceIndices] of orphans) {
    if (sourceIndices.length < 2) continue;

    findings.push({
      type: 'orphan-reference',
      description:
        `${sourceIndices.length} resources reference '${target}' ` +
        `which is not present in this batch.`,
      confidence: 0.7,
      affectedIndices: sourceIndices,
      affectedIds: sourceIndices.map(i => resources[i]?.id || `[index ${i}]`),
      resourceType: target.split('/')[0],
      suggestion:
        `Include '${target}' in the batch, or verify that the ` +
        `reference is intentionally external.`,
      outlierCount: sourceIndices.length,
    });
  }

  return findings;
}

function groupByType(resources: any[]): Map<string, ResourceEntry[]> {
  const map = new Map<string, ResourceEntry[]>();
  for (let i = 0; i < resources.length; i++) {
    const rt = resources[i]?.resourceType;
    if (!rt) continue;
    if (!map.has(rt)) map.set(rt, []);
    map.get(rt)!.push({ index: i, resource: resources[i] });
  }
  return map;
}

function collectReferences(obj: any, refs: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return refs;
  if (Array.isArray(obj)) {
    for (const item of obj) collectReferences(item, refs);
    return refs;
  }
  if (typeof obj.reference === 'string') {
    refs.push(obj.reference);
  }
  for (const key of Object.keys(obj)) {
    if (key === 'resourceType' || key === 'id') continue;
    collectReferences(obj[key], refs);
  }
  return refs;
}
