import type { AnomalyFinding } from './anomaly-types.js';
import {
  getCodings,
  getResourceId,
  getString,
  toRecord,
  type FhirRecord,
} from './anomaly-resource-utils.js';

interface PlausibilityRange {
  loincCode: string;
  display: string;
  min: number;
  max: number;
  unit: string;
  unitAliases?: string[];
}

const PLAUSIBILITY_RANGES: PlausibilityRange[] = [
  { loincCode: '8480-6',  display: 'Systolic BP',      min: 30,   max: 350,  unit: 'mm[Hg]', unitAliases: ['mmHg'] },
  { loincCode: '8462-4',  display: 'Diastolic BP',     min: 10,   max: 250,  unit: 'mm[Hg]', unitAliases: ['mmHg'] },
  { loincCode: '8310-5',  display: 'Body temperature', min: 25,   max: 45,   unit: 'Cel', unitAliases: ['degC', 'C'] },
  { loincCode: '8310-5',  display: 'Body temperature', min: 77,   max: 113,  unit: '[degF]', unitAliases: ['degF', '°F', 'F'] },
  { loincCode: '29463-7', display: 'Body weight',       min: 0.1,  max: 700,  unit: 'kg' },
  { loincCode: '8302-2',  display: 'Body height',       min: 10,   max: 300,  unit: 'cm' },
  { loincCode: '8867-4',  display: 'Heart rate',        min: 10,   max: 400,  unit: '/min' },
  { loincCode: '9279-1',  display: 'Respiratory rate',  min: 2,    max: 100,  unit: '/min' },
  { loincCode: '59408-5', display: 'SpO2',              min: 0,    max: 100,  unit: '%' },
  { loincCode: '2339-0',  display: 'Glucose',           min: 1,    max: 2000, unit: 'mg/dL' },
  { loincCode: '2345-7',  display: 'Glucose (alt)',     min: 1,    max: 2000, unit: 'mg/dL' },
  { loincCode: '718-7',   display: 'Hemoglobin',        min: 1,    max: 30,   unit: 'g/dL' },
  { loincCode: '4548-4',  display: 'HbA1c',             min: 2,    max: 25,   unit: '%' },
  { loincCode: '2093-3',  display: 'Total Cholesterol', min: 10,   max: 1500, unit: 'mg/dL' },
  { loincCode: '2571-8',  display: 'Triglycerides',     min: 5,    max: 20000, unit: 'mg/dL' },
  { loincCode: '2160-0',  display: 'Creatinine',        min: 0.01, max: 50,   unit: 'mg/dL' },
];

const PLAUSIBILITY_RANGE_MAP = buildPlausibilityRangeMap(PLAUSIBILITY_RANGES);

export function detectValueRangeOutliers(resources: unknown[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
    const resource = toRecord(resources[resourceIndex]);
    if (resource?.resourceType !== 'Observation') continue;

    checkQuantityRange(resource, resource.valueQuantity, resource.code, 'Observation.valueQuantity', resourceIndex, findings);
    if (!Array.isArray(resource.component)) continue;
    for (let componentIndex = 0; componentIndex < resource.component.length; componentIndex++) {
      const component = toRecord(resource.component[componentIndex]);
      if (!component) continue;
      checkQuantityRange(
        resource,
        component.valueQuantity,
        component.code,
        `Observation.component[${componentIndex}].valueQuantity`,
        resourceIndex,
        findings,
      );
    }
  }

  return findings;
}

function checkQuantityRange(
  observation: FhirRecord,
  quantityValue: unknown,
  codeValue: unknown,
  path: string,
  resourceIndex: number,
  findings: AnomalyFinding[],
): void {
  const quantity = toRecord(quantityValue);
  if (!quantity || typeof quantity.value !== 'number' || !Number.isFinite(quantity.value)) return;

  for (const coding of getCodings(codeValue)) {
    if (coding.system !== 'http://loinc.org') continue;
    const range = selectPlausibilityRange(getString(coding.code), quantity);
    if (!range || (quantity.value >= range.min && quantity.value <= range.max)) continue;

    const id = getResourceId(observation, resourceIndex);
    findings.push({
      type: 'value-distribution-outlier',
      description:
        `${range.display} value ${quantity.value} ${getString(quantity.unit) ?? range.unit} is outside the ` +
        `physiologically plausible range (${range.min}–${range.max} ${range.unit}). ` +
        `This is almost certainly a data-entry error or unit-conversion bug.`,
      confidence: 0.9,
      affectedIndices: [resourceIndex],
      affectedIds: [id],
      resourceType: 'Observation',
      fieldPath: path,
      suggestion:
        `Check ${id}: ${range.display} = ${quantity.value}. ` +
        `Expected range ${range.min}–${range.max} ${range.unit}. ` +
        `Common causes: wrong unit (lbs vs kg), decimal-point shift, placeholder value not replaced.`,
      outlierCount: 1,
    });
  }
}

function selectPlausibilityRange(loincCode: string | undefined, quantity: FhirRecord): PlausibilityRange | undefined {
  if (!loincCode) return undefined;
  const ranges = PLAUSIBILITY_RANGE_MAP.get(loincCode);
  const unit = normalizeUnit(getString(quantity.code) ?? getString(quantity.unit));
  if (!ranges?.length || !unit) return undefined;
  return ranges.find((range) =>
    [range.unit, ...(range.unitAliases ?? [])].some((candidate) => normalizeUnit(candidate) === unit),
  );
}

function buildPlausibilityRangeMap(ranges: PlausibilityRange[]): ReadonlyMap<string, readonly PlausibilityRange[]> {
  const byCode = new Map<string, PlausibilityRange[]>();
  for (const range of ranges) {
    const existing = byCode.get(range.loincCode);
    if (existing) existing.push(range);
    else byCode.set(range.loincCode, [range]);
  }
  return byCode;
}

function normalizeUnit(unit: string | undefined): string | undefined {
  return unit?.trim().toLowerCase();
}
