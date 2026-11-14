import type { SlicingDefinition } from '../core/structure-definition-types.js';
import type { SliceDefinition } from './slice-types.js';

/** Shape cannot distinguish extension-only datatypes or primitive strings; the concrete property can. */
export function choiceBindingSliceMembership(
  slicing: SlicingDefinition,
  definitionPath: string,
  fullPath: string,
  slices: SliceDefinition[],
  sliceName: string,
): 'matched' | 'nonmember' | 'ambiguous' | undefined {
  if (slicing.discriminator?.length !== 1 || slicing.discriminator[0].type !== 'type'
    || slicing.discriminator[0].path !== '$this' || !definitionPath.endsWith('[x]')) return undefined;
  const segments = definitionPath.split('.');
  const base = segments.at(-1)!.slice(0, -3);
  const concrete = fullPath.split('.')[segments.length - 1]?.replace(/\[\d+\]$/, '');
  const types = new Set(slices.flatMap(slice => (slice.type ?? []).map(type => type.code)));
  const selectedType = [...types].find(type => type && concrete === base + type[0].toUpperCase() + type.slice(1));
  if (!selectedType) return undefined;
  const matches = slices.filter(slice => slice.type?.some(type => type.code === selectedType));
  if (matches.length > 1) return 'ambiguous';
  return matches[0]?.sliceName === sliceName ? 'matched' : 'nonmember';
}
