import type {
  ElementDefinition,
  SlicingDefinition,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import { extractFixedEntry } from './slice-utils.js';

export type TypeSpec = {
  code: string;
  profile?: string[];
  targetProfile?: string[];
};

export function getProfileElements(
  profile: StructureDefinition | null | undefined,
): ElementDefinition[] {
  const profileRecord = toRecord(profile);
  const snapshot = toRecord(profileRecord?.snapshot);
  const differential = toRecord(profileRecord?.differential);
  const snapshotElements = normalizeElements(snapshot?.element);
  return snapshotElements.length > 0
    ? snapshotElements
    : normalizeElements(differential?.element);
}

export function getElementTypes(element: ElementDefinition): TypeSpec[] {
  if (!Array.isArray(element.type)) return [];
  return element.type.flatMap(candidate => {
    const record = toRecord(candidate);
    const code = getNonEmptyString(record?.code);
    if (!code) return [];
    const profile = normalizeStringArray(record?.profile);
    const targetProfile = normalizeStringArray(record?.targetProfile);
    return [{
      code,
      profile: profile.length > 0 ? profile : undefined,
      targetProfile: targetProfile.length > 0 ? targetProfile : undefined,
    }];
  });
}

export function getSlicingDefinition(
  element: ElementDefinition | undefined,
): SlicingDefinition | undefined {
  const slicing = toRecord(element?.slicing);
  if (!slicing) return undefined;

  const discriminator = Array.isArray(slicing.discriminator)
    ? slicing.discriminator.flatMap(candidate => {
      const record = toRecord(candidate);
      const type = getNonEmptyString(record?.type);
      const path = getNonEmptyString(record?.path);
      if (!isDiscriminatorType(type) || !path) return [];
      return [{ type, path }];
    })
    : [];
  const rules = slicing.rules === 'closed'
    || slicing.rules === 'open'
    || slicing.rules === 'openAtEnd'
    ? slicing.rules
    : undefined;

  return {
    discriminator: discriminator.length > 0 ? discriminator : undefined,
    rules,
    ordered: typeof slicing.ordered === 'boolean' ? slicing.ordered : undefined,
    description: getNonEmptyString(slicing.description),
  };
}

export function isSliceInScope(
  element: ElementDefinition,
  slicingElementId: string | undefined,
): boolean {
  if (!slicingElementId) return true;
  return typeof element.id === 'string'
    && element.id.startsWith(`${slicingElementId}:`);
}

export function normalizeCodes(value: unknown): string[] {
  return Array.from(new Set(normalizeStringArray(value)));
}

export function collectChildBindingDiscriminatorPaths(
  slicing: SlicingDefinition,
): Set<string> {
  const paths = new Set<string>();
  for (const discriminator of slicing.discriminator ?? []) {
    const path = normalizeChildBindingDiscriminatorPath(discriminator.path);
    if (path) paths.add(path);
  }
  return paths;
}

export function childBindingAppliesToDiscriminatorPath(
  relativePath: string,
  discriminatorPaths: Set<string>,
): boolean {
  for (const discriminatorPath of discriminatorPaths) {
    if (
      discriminatorPath === relativePath
      || discriminatorPath.startsWith(`${relativePath}.`)
    ) {
      return true;
    }
  }
  return false;
}

export function inferInheritedSlicing(
  sliceElements: ElementDefinition[],
): SlicingDefinition {
  const hasFixedSlice = sliceElements.some(
    element => extractFixedEntry(element) !== undefined,
  );
  return {
    discriminator: [{
      type: hasFixedSlice ? 'value' : 'pattern',
      path: '$this',
    }],
    rules: 'open',
    ordered: false,
    description:
      'Inferred from differential slice elements whose slicing declaration is inherited from a base profile.',
  };
}

export function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeElements(value: unknown): ElementDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    const record = toRecord(candidate);
    return typeof record?.path === 'string' && record.path.length > 0
      ? [record as ElementDefinition]
      : [];
  });
}

function isDiscriminatorType(
  value: string | undefined,
): value is 'value' | 'pattern' | 'type' | 'profile' | 'exists' {
  return value === 'value'
    || value === 'pattern'
    || value === 'type'
    || value === 'profile'
    || value === 'exists';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0,
  );
}

function normalizeChildBindingDiscriminatorPath(
  path?: string,
): string | null {
  if (!path || path === '$this') return null;
  if (path.startsWith('$this.')) return path.slice('$this.'.length);
  if (path.startsWith('resolve()')) return null;
  return path;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
