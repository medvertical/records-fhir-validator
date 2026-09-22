import type { RecordsValidator } from './core/validator-engine.js';

type ConstraintDiagnostics = ReturnType<RecordsValidator['getConstraintDiagnostics']>;
const MAX_AGGREGATED_SAMPLES = 25;

export function mergeConstraintDiagnostics(
  reports: ConstraintDiagnostics[],
): ConstraintDiagnostics {
  const first = reports[0];
  if (!first) throw new Error('At least one validator runtime is required');
  const merged: ConstraintDiagnostics = {
    skippedConstraints: {
      total: first.skippedConstraints.total,
      byReason: { ...first.skippedConstraints.byReason },
      byConstraintKey: { ...first.skippedConstraints.byConstraintKey },
      byProfile: { ...first.skippedConstraints.byProfile },
      samples: [...first.skippedConstraints.samples],
    },
  };
  for (const report of reports.slice(1)) {
    merged.skippedConstraints.total += report.skippedConstraints.total;
    addCounts(merged.skippedConstraints.byReason, report.skippedConstraints.byReason);
    addCounts(merged.skippedConstraints.byConstraintKey, report.skippedConstraints.byConstraintKey);
    addCounts(merged.skippedConstraints.byProfile, report.skippedConstraints.byProfile);
    merged.skippedConstraints.samples.push(...report.skippedConstraints.samples);
  }
  merged.skippedConstraints.samples = merged.skippedConstraints.samples
    .slice(0, MAX_AGGREGATED_SAMPLES);
  return merged;
}

function addCounts<Key extends string>(
  target: Record<Key, number>,
  source: Readonly<Record<Key, number>>,
): void {
  for (const [key, value] of Object.entries(source) as Array<[Key, number]>) {
    target[key] = (target[key] ?? 0) + value;
  }
}
