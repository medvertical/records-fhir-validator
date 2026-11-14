import { hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const optionalText = (value: unknown) => value === undefined || typeof value === 'string' && value.length > 0;

/** A typed loader result still needs a trustworthy finite-set shape before absence can prove invalidity. */
export function finiteTerminologyAuthorityFailure(input: unknown, kind: 'CodeSystem' | 'ValueSet' | 'expansion', limit: number): string | undefined {
  const source = record(input);
  if (!source) return 'terminology-invalid-shape';
  if (hasUnknownTerminologyModifiers(source)) return 'terminology-modifiers-unsupported';
  if (!validExtensions(source.extension) || !validMetadataTags(source.meta)) return 'terminology-invalid-shape';
  if (kind === 'expansion' && source.parameter !== undefined && (!Array.isArray(source.parameter)
    || source.parameter.some(raw => {
      const parameter = record(raw);
      return !parameter || typeof parameter.name !== 'string' || hasUnknownTerminologyModifiers(parameter)
        || parameter.valueString !== undefined && typeof parameter.valueString !== 'string'
        || parameter.valueBoolean !== undefined && typeof parameter.valueBoolean !== 'boolean';
    }))) return 'terminology-invalid-shape';
  if (!Number.isSafeInteger(limit) || limit <= 0) return 'terminology-shape-budget';
  if (kind === 'CodeSystem' && (typeof source.url !== 'string' || !source.url || !optionalText(source.version)
    || ['caseSensitive', 'compositional'].some(key => source[key] !== undefined && typeof source[key] !== 'boolean'))) return 'terminology-invalid-shape';
  const tree = kind === 'CodeSystem' ? source.concept : kind === 'expansion' ? source.contains : undefined;
  if (tree !== undefined) {
    const failure = checkConceptTree(tree, kind === 'CodeSystem' ? 'concept' : 'contains', limit);
    if (failure) return failure;
  }
  if (kind !== 'ValueSet') return undefined;
  if (!optionalText(source.url) || !optionalText(source.version)) return 'terminology-invalid-shape';
  if (source.compose === undefined) return undefined;
  const compose = record(source.compose);
  if (!compose) return 'terminology-invalid-shape';
  if (hasUnknownTerminologyModifiers(compose)) return 'terminology-modifiers-unsupported';
  for (const key of ['include', 'exclude']) {
    const entries = compose[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > limit) return 'terminology-invalid-shape';
    for (const raw of entries) {
      const entry = record(raw);
      if (!entry || !optionalText(entry.system) || !optionalText(entry.version)) return 'terminology-invalid-shape';
      if (hasUnknownTerminologyModifiers(entry)) return 'terminology-modifiers-unsupported';
      if (typeof entry.system === 'string' && entry.version && entry.system.includes('|')
        && entry.system.split('|')[1] !== entry.version) return 'compose-system-version-conflict';
      if (entry.concept !== undefined) {
        const failure = checkConceptTree(entry.concept, 'concept', limit);
        if (failure) return failure;
      }
      if (entry.valueSet !== undefined && (!Array.isArray(entry.valueSet) || entry.valueSet.some(value => typeof value !== 'string' || !value))) return 'terminology-invalid-shape';
      if (entry.filter !== undefined && (!Array.isArray(entry.filter) || entry.filter.some(rawFilter => {
        const filter = record(rawFilter);
        return !filter || hasUnknownTerminologyModifiers(filter) || ['property', 'op', 'value'].some(field => typeof filter[field] !== 'string');
      }))) return 'terminology-invalid-shape';
    }
  }
  return undefined;
}

function checkConceptTree(input: unknown, childKey: 'concept' | 'contains', limit: number): string | undefined {
  const pending = [input], seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length) {
    const entries = pending.pop();
    if (!Array.isArray(entries)) return 'terminology-invalid-shape';
    for (const raw of entries) {
      const concept = record(raw);
      if (!concept || seen.has(concept) || !optionalText(concept.code) || (childKey === 'concept' && concept.code === undefined)
        || !optionalText(concept.system) || !optionalText(concept.version)
        || ['abstract', 'inactive'].some(key => concept[key] !== undefined && typeof concept[key] !== 'boolean')) return 'terminology-invalid-shape';
      if (hasUnknownTerminologyModifiers(concept)) return 'terminology-modifiers-unsupported';
      if (!validExtensions(concept.extension)) return 'terminology-invalid-shape';
      seen.add(concept);
      if (++visited > limit) return 'expansion-size-limit';
      if (concept[childKey] !== undefined) pending.push(concept[childKey]);
    }
  }
  return undefined;
}

function validExtensions(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.every(extension => {
    const entry = record(extension); return !!entry && typeof entry.url === 'string' && entry.url.length > 0;
  });
}

function validMetadataTags(value: unknown): boolean {
  if (value === undefined) return true;
  const meta = record(value);
  return !!meta && (meta.tag === undefined || Array.isArray(meta.tag) && meta.tag.every(tag => {
    const entry = record(tag); return !!entry && optionalText(entry.code) && optionalText(entry.system);
  }));
}
