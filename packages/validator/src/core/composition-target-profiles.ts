import type { StructureDefinition } from './structure-definition-types';

export function getCompositionEntryTargetProfiles(
  structureDef: StructureDefinition | undefined,
  section: Record<string, unknown>,
): string[] | null {
  const elements = structureDef?.snapshot?.element;
  if (!elements?.length) return null;

  const sectionSliceName = findMatchingSectionSliceName(elements, section);
  if (sectionSliceName) {
    const sliceProfiles = collectTargetProfiles(elements, element =>
      element.path === 'Composition.section.entry' &&
      typeof element.id === 'string' &&
      element.id.startsWith(`Composition.section:${sectionSliceName}.entry:`),
    );
    if (sliceProfiles && sliceProfiles.length > 0) return sliceProfiles;

    const sectionEntryProfiles = collectTargetProfiles(elements, element =>
      element.path === 'Composition.section.entry' &&
      element.id === `Composition.section:${sectionSliceName}.entry`,
    );
    if (sectionEntryProfiles && sectionEntryProfiles.length > 0) return sectionEntryProfiles;
  }

  return collectTargetProfiles(elements, element => element.path === 'Composition.section.entry');
}

function collectTargetProfiles(
  elements: NonNullable<StructureDefinition['snapshot']>['element'],
  predicate: (element: NonNullable<StructureDefinition['snapshot']>['element'][number]) => boolean,
): string[] | null {
  const profiles = new Set<string>();
  for (const element of elements) {
    if (!predicate(element)) continue;
    const types = (element as any).type;
    if (!Array.isArray(types)) continue;
    for (const type of types) {
      const targetProfiles = Array.isArray(type?.targetProfile) ? type.targetProfile : [];
      for (const profile of targetProfiles) {
        if (typeof profile === 'string') profiles.add(profile);
      }
    }
  }

  return profiles.size > 0 ? [...profiles] : null;
}

function findMatchingSectionSliceName(
  elements: NonNullable<StructureDefinition['snapshot']>['element'],
  section: Record<string, unknown>,
): string | null {
  for (const element of elements) {
    if (element.path !== 'Composition.section' || !element.sliceName) continue;

    const codeElement = elements.find(candidate =>
      candidate.id === `Composition.section:${element.sliceName}.code` &&
      candidate.path === 'Composition.section.code',
    );
    const expectedCode = getCodeableConceptConstraint(codeElement);
    if (!expectedCode) continue;
    if (codeableConceptMatches(section.code, expectedCode)) return element.sliceName;
  }

  return null;
}

function getCodeableConceptConstraint(element: unknown): unknown {
  if (!element || typeof element !== 'object') return null;
  const record = element as Record<string, unknown>;
  return record.patternCodeableConcept ?? record.fixedCodeableConcept ?? null;
}

function codeableConceptMatches(actual: unknown, expected: unknown): boolean {
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') {
    return false;
  }

  const expectedRecord = expected as Record<string, unknown>;
  const expectedCodings = Array.isArray(expectedRecord.coding)
    ? expectedRecord.coding.filter(isRecord)
    : [];
  if (expectedCodings.length === 0) return false;

  const actualRecord = actual as Record<string, unknown>;
  const actualCodings = Array.isArray(actualRecord.coding)
    ? actualRecord.coding.filter(isRecord)
    : [];

  return expectedCodings.every(expectedCoding =>
    actualCodings.some(actualCoding => codingMatches(actualCoding, expectedCoding)),
  );
}

function codingMatches(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return stringFieldMatches(actual, expected, 'system') &&
    stringFieldMatches(actual, expected, 'code') &&
    stringFieldMatches(actual, expected, 'display');
}

function stringFieldMatches(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  field: string,
): boolean {
  return typeof expected[field] !== 'string' || actual[field] === expected[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
