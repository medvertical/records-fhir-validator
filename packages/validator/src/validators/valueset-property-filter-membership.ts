import type { CodeSystem, ValueSetComposeInclude } from './valueset-types.js';

type Filter = NonNullable<ValueSetComposeInclude['filter']>[number];
type RecordValue = Record<string, unknown>;
type ModifierCheck = (value: unknown) => boolean;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : undefined;
}

function propertyDefinition(codeSystem: CodeSystem, filter: Filter, modified: ModifierCheck): RecordValue | undefined {
  if (filter.op !== '=' || typeof filter.property !== 'string' || !filter.property || typeof filter.value !== 'string' || !filter.value
    || !['complete', 'fragment'].includes(codeSystem.content ?? '') || !Array.isArray(codeSystem.property)) return undefined;
  const definitions = codeSystem.property.filter(definition => record(definition)?.code === filter.property);
  if (definitions.length !== 1) return undefined;
  const definition = record(definitions[0]);
  if (!definition || modified(definition) || typeof definition.type !== 'string' || !['code', 'string', 'boolean'].includes(definition.type)
    || (definition.uri !== undefined && (typeof definition.uri !== 'string' || !definition.uri))) return undefined;
  // A same-name custom filter needs its own interpreter, even if it permits '='.
  if (codeSystem.filter !== undefined && (!Array.isArray(codeSystem.filter) || codeSystem.filter.some(raw => {
    const custom = record(raw);
    return !custom || typeof custom.code !== 'string' || custom.code === filter.property;
  }))) return undefined;
  if (definition.type === 'boolean' && filter.value !== 'true' && filter.value !== 'false') return undefined;
  return definition;
}

export function canMatchDeclaredPropertyEquality(codeSystem: CodeSystem, filter: Filter, modified: ModifierCheck): boolean {
  return propertyDefinition(codeSystem, filter, modified) !== undefined;
}

/** Concepts/definitions completeness does not certify every repeated property value. */
export function propertyFilterMembership(
  codeSystem: CodeSystem, concept: RecordValue | undefined, filter: Filter, modified: ModifierCheck,
): true | null {
  const definition = propertyDefinition(codeSystem, filter, modified);
  if (!definition || !concept || modified(concept) || !Array.isArray(concept.property)) return null;
  for (const raw of concept.property) {
    const fact = record(raw);
    if (!fact || fact.code !== filter.property || modified(fact)) continue;
    const fields = Object.keys(fact).filter(key => key.startsWith('value') && fact[key] !== undefined);
    if (fields.length !== 1) continue;
    const field = fields[0];
    if (definition.type === 'boolean' && field === 'valueBoolean' && typeof fact.valueBoolean === 'boolean'
      && fact.valueBoolean === (filter.value === 'true')) return true;
    if ((definition.type === 'code' && field === 'valueCode') || (definition.type === 'string' && field === 'valueString')) {
      if (typeof fact[field] === 'string' && fact[field] === filter.value) return true;
    }
  }
  // A trusted matching sibling proves existence; unknown siblings cannot prove absence.
  return null;
}
