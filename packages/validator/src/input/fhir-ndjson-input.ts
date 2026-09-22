import type {
  FhirInputLimits,
  ParsedFhirInput,
} from './fhir-input-types.js';

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 100_000;

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

export function parseFhirNdjson(
  source: string,
  limits: FhirInputLimits = {},
): ParsedFhirInput {
  const maxBytes = positiveLimit(limits.maxBytes, DEFAULT_MAX_BYTES);
  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    throw new Error('FHIR NDJSON input exceeded byte limit');
  }
  const maxLineBytes = positiveLimit(limits.maxLineBytes, DEFAULT_MAX_LINE_BYTES);
  const maxRecords = positiveLimit(limits.maxRecords, DEFAULT_MAX_RECORDS);
  const resources: Array<Record<string, unknown>> = [];
  const sourceMap: ParsedFhirInput['sourceMap'] = {};
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      if (index === lines.length - 1) continue;
      throw new Error(`FHIR NDJSON line ${index + 1} is empty`);
    }
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
      throw new Error(`FHIR NDJSON line ${index + 1} exceeded byte limit`);
    }
    if (resources.length >= maxRecords) {
      throw new Error('FHIR NDJSON input exceeded record limit');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`FHIR NDJSON line ${index + 1} is not valid JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`FHIR NDJSON line ${index + 1} must contain a JSON object`);
    }
    const resource = parsed as Record<string, unknown>;
    if (typeof resource.resourceType !== 'string' || !resource.resourceType.trim()) {
      throw new Error(`FHIR NDJSON line ${index + 1} is missing resourceType`);
    }
    const resourceIndex = resources.length;
    resources.push(resource);
    sourceMap[`resources[${resourceIndex}]`] = { line: index + 1, column: 1 };
  }

  if (resources.length === 0) {
    throw new Error('FHIR NDJSON input contains no resources');
  }
  return { format: 'ndjson', resources, sourceMap };
}
