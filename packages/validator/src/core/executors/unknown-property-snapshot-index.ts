import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';

const CHOICE_TYPE_SUFFIXES = [
  'String', 'Boolean', 'Integer', 'Decimal', 'DateTime', 'Date', 'Time',
  'Instant', 'Uri', 'Url', 'Canonical', 'Base64Binary', 'Code', 'Oid', 'Id',
  'Markdown', 'UnsignedInt', 'PositiveInt', 'Integer64', 'Uuid', 'Quantity', 'Range',
  'Ratio', 'RatioRange', 'Period', 'Coding', 'CodeableConcept', 'CodeableReference', 'Identifier', 'Reference',
  'Attachment', 'Address', 'Age', 'Annotation', 'ContactPoint', 'Count',
  'Distance', 'Duration', 'HumanName', 'Money', 'SampledData', 'Signature',
  'Timing', 'ContactDetail', 'Contributor', 'DataRequirement', 'Expression',
  'ParameterDefinition', 'RelatedArtifact', 'TriggerDefinition', 'UsageContext',
  'Dosage', 'Meta', 'Availability', 'ExtendedContactDetail', 'VirtualServiceDetail',
];

interface PathInfo {
  type?: string;
}

export interface SnapshotIndex {
  knownPaths: Set<string>;
  byPath: Map<string, PathInfo>;
}

export function buildSnapshotIndex(sd: StructureDefinition | undefined): SnapshotIndex {
  const knownPaths = new Set<string>();
  const byPath = new Map<string, PathInfo>();
  for (const element of sd?.snapshot?.element || []) {
    if (!element?.path || (typeof element.id === 'string' && element.id.includes(':'))) continue;
    const type = element.type?.[0]?.code;
    byPath.set(element.path, { type });
    if (!element.path.endsWith('[x]')) {
      knownPaths.add(element.path);
      continue;
    }
    const base = element.path.slice(0, -3);
    knownPaths.add(base);
    for (const suffix of choiceSuffixesForElement(element)) {
      knownPaths.add(base + suffix);
      byPath.set(base + suffix, { type: suffix });
    }
  }
  return { knownPaths, byPath };
}

function choiceSuffixesForElement(element: ElementDefinition): string[] {
  const suffixes = (Array.isArray(element.type) ? element.type : [])
    .map((type) => typeof type?.code === 'string' ? typeCodeToChoiceSuffix(type.code) : null)
    .filter((suffix): suffix is string => Boolean(suffix));
  return suffixes.length > 0 ? Array.from(new Set(suffixes)) : CHOICE_TYPE_SUFFIXES;
}

function typeCodeToChoiceSuffix(typeCode: string): string {
  const normalized = typeCode.includes('/') ? typeCode.slice(typeCode.lastIndexOf('/') + 1) : typeCode;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
