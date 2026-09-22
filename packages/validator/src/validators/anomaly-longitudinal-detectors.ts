import type { AnomalyFinding } from './anomaly-types.js';
import {
  getCodings,
  getPrimaryCode,
  getResourceId,
  getResourceType,
  getString,
  getSubjectReference,
  toRecord,
} from './anomaly-resource-utils.js';

interface TimelineEvent {
  date: Date;
  index: number;
  rt: string;
  id: string;
  subject: string;
}

export function detectTemporalGaps(resources: unknown[], temporalGapDays: number): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const gapMs = temporalGapDays * 24 * 60 * 60 * 1000;
  const subjectTimelines = new Map<string, TimelineEvent[]>();

  for (let index = 0; index < resources.length; index++) {
    const resource = toRecord(resources[index]);
    const resourceType = getResourceType(resource);
    if (!resource || !resourceType) continue;
    const subject = getSubjectReference(resource);
    const dateString = getClinicalDate(resource, resourceType);
    if (!subject || !dateString) continue;
    const date = new Date(dateString);
    const code = getPrimaryCode(resource);
    if (Number.isNaN(date.getTime()) || !code) continue;

    const timelineKey = JSON.stringify([subject, resourceType, code]);
    const timeline = subjectTimelines.get(timelineKey) ?? [];
    timeline.push({ date, index, rt: resourceType, id: getResourceId(resource, index), subject });
    subjectTimelines.set(timelineKey, timeline);
  }

  for (const events of subjectTimelines.values()) {
    if (events.length < 2) continue;
    events.sort((left, right) => left.date.getTime() - right.date.getTime());
    for (let index = 1; index < events.length; index++) {
      const previous = events[index - 1];
      const current = events[index];
      const diffMs = current.date.getTime() - previous.date.getTime();
      if (diffMs <= gapMs) continue;
      findings.push(createTemporalGapFinding(previous, current, diffMs));
    }
  }

  return findings;
}

export function detectCodingInconsistencies(resources: unknown[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const byDisplay = new Map<string, Array<{ index: number; id: string; system: string; code: string }>>();

  for (let index = 0; index < resources.length; index++) {
    const resource = toRecord(resources[index]);
    if (resource?.resourceType !== 'Condition' && resource?.resourceType !== 'AllergyIntolerance') continue;
    for (const coding of getCodings(resource.code)) {
      const display = getString(coding.display)?.toLowerCase().trim();
      if (!display || display.length < 3) continue;
      const entries = byDisplay.get(display) ?? [];
      entries.push({
        index,
        id: getResourceId(resource, index),
        system: getString(coding.system) ?? '(no system)',
        code: getString(coding.code) ?? '(no code)',
      });
      byDisplay.set(display, entries);
    }
  }

  for (const [display, entries] of byDisplay) {
    const uniqueCodes = new Map<string, { system: string; code: string }>();
    for (const entry of entries) {
      uniqueCodes.set(JSON.stringify([entry.system, entry.code]), { system: entry.system, code: entry.code });
    }
    if (uniqueCodes.size < 2) continue;
    const codeList = Array.from(uniqueCodes.values())
      .map((entry) => `${entry.system.split('/').pop() || entry.system}#${entry.code}`)
      .join(', ');
    findings.push({
      type: 'coding-inconsistency',
      description:
        `'${display}' is coded differently across ${entries.length} resources: ${codeList}. ` +
        `Inconsistent coding breaks cohort queries and analytics.`,
      confidence: 0.75,
      affectedIndices: entries.map((entry) => entry.index),
      affectedIds: entries.map((entry) => entry.id),
      resourceType: 'Condition',
      suggestion:
        `Standardize coding for '${display}'. Pick one authoritative ` +
        `code system (preferably SNOMED CT) and map all instances to it.`,
      outlierCount: entries.length,
    });
  }

  return findings;
}

function getClinicalDate(resource: Record<string, unknown>, resourceType: string): string | undefined {
  switch (resourceType) {
    case 'Encounter': return getString(toRecord(resource.period)?.start);
    case 'Observation': return getString(resource.effectiveDateTime) ?? getString(toRecord(resource.effectivePeriod)?.start);
    case 'Condition': return getString(resource.onsetDateTime) ?? getString(resource.recordedDate);
    case 'Procedure': return getString(resource.performedDateTime) ?? getString(toRecord(resource.performedPeriod)?.start);
    case 'MedicationRequest': return getString(resource.authoredOn);
    case 'DiagnosticReport': return getString(resource.effectiveDateTime) ?? getString(toRecord(resource.effectivePeriod)?.start);
    default: return undefined;
  }
}

function createTemporalGapFinding(previous: TimelineEvent, current: TimelineEvent, diffMs: number): AnomalyFinding {
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  const diffMonths = Math.round(diffDays / 30);
  const previousDate = previous.date.toISOString().slice(0, 10);
  const currentDate = current.date.toISOString().slice(0, 10);
  return {
    type: 'temporal-gap',
    description:
      `${diffMonths}-month gap (${diffDays} days) in care timeline for ${current.subject}: ` +
      `last event ${previous.rt}/${previous.id} on ${previousDate}, ` +
      `next event ${current.rt}/${current.id} on ${currentDate}.`,
    confidence: Math.min(0.5 + (diffDays / 365) * 0.3, 0.9),
    affectedIndices: [previous.index, current.index],
    affectedIds: [previous.id, current.id],
    resourceType: 'Patient',
    fieldPath: current.subject,
    suggestion:
      `Check whether events between ${previousDate} and ${currentDate} were missed during import. ` +
      `If the gap is real (patient transferred care), no action needed.`,
    outlierCount: 1,
  };
}
