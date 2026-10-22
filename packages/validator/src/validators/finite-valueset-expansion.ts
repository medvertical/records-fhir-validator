import type { CodeSystem, ValueSet, ValueSetComposeInclude, ValueSetExpansionContains } from './valueset-types.js';
import { createConceptFilterEvaluator, supportsLocalFilter } from './valueset-concept-filter-membership.js';

export interface FiniteConcept { system?: string; version?: string; code: string }
export interface FiniteExpansion {
  concepts: FiniteConcept[];
  coverage: 'complete' | 'partial';
  reasons: string[];
  source: 'expansion' | 'compose';
}
export interface FiniteTerminologyResolver {
  valueSet(canonical: string): Promise<ValueSet | null>;
  codeSystem(canonical: string, version?: string): Promise<CodeSystem | null>;
}

const identity = (c: FiniteConcept) => JSON.stringify([c.system ?? null, c.version ?? null, c.code]);
const grammarSystems = new Set(['http://unitsofmeasure.org', 'http://varnomen.hgvs.org',
  'urn:ietf:bcp:47', 'urn:ietf:bcp:13', 'urn:ietf:rfc:3986', 'urn:dicom:uid']);
export const hasNonEnumerableCodeGrammar = (cs: Pick<CodeSystem, 'url' | 'compositional'>): boolean =>
  cs.compositional === true || grammarSystems.has(cs.url);
const subsetted = (r: Pick<CodeSystem, 'meta' | 'extension'>) => r.meta?.tag?.some(t => t.code === 'SUBSETTED')
  || r.extension?.some(e => e.url === 'http://health-samurai.io/extensions/excised-data');
const overlaps = (a: FiniteConcept, b: FiniteConcept) => a.system === b.system && a.code === b.code
  && (!a.version || !b.version || a.version === b.version);

export function assessFiniteCodeSystem(cs: CodeSystem, limit = 250_000) {
  const concepts = new Map<string, FiniteConcept>();
  const reasons = new Set<string>();
  if (hasNonEnumerableCodeGrammar(cs)) reasons.add('codesystem-grammar-not-enumerable');
  if (subsetted(cs)) reasons.add('codesystem-declared-incomplete');
  if (cs.content !== 'complete' || !Array.isArray(cs.concept)
    || (!cs.concept.length && cs.count !== 0)) reasons.add('codesystem-inventory-unproven');
  const walk = (entries: NonNullable<CodeSystem['concept']>, depth: number) => {
    if (depth > 30) { reasons.add('codesystem-depth-limit'); return; }
    for (const c of entries) {
      if (!c.code || concepts.has(c.code)) reasons.add('codesystem-invalid-or-duplicate-concept');
      if (concepts.size >= limit) { reasons.add('expansion-size-limit'); return; }
      concepts.set(c.code, { system: cs.url, version: cs.version, code: c.code });
      if (c.concept) walk(c.concept, depth + 1);
    }
  };
  walk(cs.concept ?? [], 0);
  if (cs.count !== undefined && (!Number.isSafeInteger(cs.count) || cs.count !== concepts.size)) reasons.add('codesystem-count-mismatch');
  return { concepts: [...concepts.values()], coverage: reasons.size ? 'partial' as const : 'complete' as const, reasons: [...reasons].sort() };
}

/** A closed finite expansion is evidence of absence; a partial list is not. */
export function assessStoredExpansion(valueSet: ValueSet, limit = 250_000): FiniteExpansion | null {
  const expansion = valueSet.expansion;
  if (!expansion) return null;
  const concepts = new Map<string, FiniteConcept>();
  const reasons = new Set<string>();
  const walk = (entries: ValueSetExpansionContains[], depth: number, parent?: FiniteConcept) => {
    if (depth > 30) { reasons.add('expansion-depth-limit'); return; }
    for (const entry of entries) {
      const system = entry.system ?? parent?.system;
      const version = entry.version ?? parent?.version;
      if (entry.code && !entry.abstract) {
        if (!system) reasons.add('expansion-system-missing');
        if (concepts.size >= limit) { reasons.add('expansion-size-limit'); return; }
        const concept = { system, version, code: entry.code };
        const key = identity(concept);
        if (concepts.has(key)) reasons.add('duplicate-expansion-concept');
        concepts.set(key, concept);
      }
      if (entry.contains) walk(entry.contains, depth + 1, { system, version, code: entry.code });
    }
  };
  walk(expansion.contains ?? [], 0);
  if (subsetted(valueSet)) reasons.add('expansion-declared-incomplete');
  if (expansion.offset !== undefined && expansion.offset !== 0) reasons.add('expansion-offset');
  if (expansion.parameter?.some(p => (p.name === 'filter' && Boolean(p.valueString))
    || (['activeOnly', 'excludePostCoordinated'].includes(p.name) && p.valueBoolean !== false)
    || p.name === 'exclude-system' || p.name === 'force-system-version')) reasons.add('expansion-parameters-restrict-membership');
  if (!Number.isSafeInteger(expansion.total) || expansion.total !== concepts.size) reasons.add('expansion-total-unproven');
  if ([...(valueSet.extension ?? []), ...(expansion.extension ?? [])].some(e =>
    /(?:valueset-unclosed|valueset-toocostly|expansion-incomplete)$/.test(e.url) && e.valueBoolean !== false)) {
    reasons.add('expansion-declared-incomplete');
  }
  return { concepts: [...concepts.values()], reasons: [...reasons].sort(),
    coverage: reasons.size ? 'partial' : 'complete', source: 'expansion' };
}

export async function expandFiniteValueSet(valueSet: ValueSet, resolver: FiniteTerminologyResolver,
  limit = 250_000, ancestors = new Set<string>()): Promise<FiniteExpansion> {
  if ([...(valueSet.compose?.include ?? []), ...(valueSet.compose?.exclude ?? [])].some(entry => entry.system
    && grammarSystems.has(entry.system.split('|')[0]) && !entry.concept?.length)) {
    return { concepts: [], coverage: 'partial', reasons: ['codesystem-grammar-not-enumerable'], source: 'compose' };
  }
  const stored = assessStoredExpansion(valueSet, limit);
  if (stored?.coverage === 'complete') return stored;
  const canonical = `${valueSet.url}|${valueSet.version ?? ''}`;
  const partial = (reason: string): FiniteExpansion => ({ concepts: [], coverage: 'partial', reasons: [reason], source: 'compose' });
  if (ancestors.size >= 20 || ancestors.has(canonical)) return partial('composition-cycle-or-depth');
  if (!valueSet.compose?.include?.length) return stored ?? partial('valueset-definition-missing');
  if (valueSet.compose.lockedDate || valueSet.compose.inactive !== undefined) return partial('compose-options-unsupported');
  const visited = new Set(ancestors).add(canonical);
  const reasons = new Set<string>();
  const concepts = new Map<string, FiniteConcept>();
  const evaluateFilter = createConceptFilterEvaluator();
  const entry = async (include: ValueSetComposeInclude): Promise<FiniteConcept[]> => {
    if (include.filter?.length && include.concept?.length) { reasons.add('compose-concepts-and-filters'); return []; }
    if ((include.filter?.length ?? 0) > 32) { reasons.add('filter-count-limit'); return []; }
    if (include.filter?.length && !include.system) { reasons.add('compose-system-missing'); return []; }
    const constraints: FiniteConcept[][] = [];
    if (include.system) {
      const [system, pipedVersion] = include.system.split('|');
      const version = include.version ?? pipedVersion;
      if (include.concept?.length) {
        constraints.push(include.concept.map(c => ({ system, version, code: c.code })));
      } else {
        const cs = await resolver.codeSystem(system, version);
        if (!cs || cs.content !== 'complete' || cs.url !== system || (version && cs.version !== version)) {
          reasons.add(`codesystem-unavailable-or-incomplete:${system}|${version ?? ''}`);
          constraints.push([]);
        } else {
          const inventory = assessFiniteCodeSystem(cs, limit);
          inventory.reasons.forEach(reason => reasons.add(reason));
          const filters = include.filter ?? [];
          if (filters.some(filter => !supportsLocalFilter(cs, filter))) {
            reasons.add('unsupported-filter');
            constraints.push([]);
          } else {
            const filtered = inventory.concepts.filter(concept => {
              const outcomes = filters.map(filter => evaluateFilter(cs, concept.code, filter));
              if (outcomes.some(outcome => outcome === null)) reasons.add('filter-membership-unproven');
              return outcomes.every(outcome => outcome === true);
            });
            constraints.push(filtered);
          }
        }
      }
    } else if (include.concept?.length) reasons.add('compose-system-missing');
    for (const reference of include.valueSet ?? []) {
      const nested = await resolver.valueSet(reference);
      const [url, version] = reference.split('|');
      if (!nested || nested.url !== url || (version && nested.version !== version)) {
        reasons.add(`valueset-unavailable:${reference}`); constraints.push([]); continue;
      }
      const result = await expandFiniteValueSet(nested, resolver, limit, visited);
      result.reasons.forEach(reason => reasons.add(reason));
      constraints.push(result.concepts);
    }
    if (!constraints.length) { reasons.add('compose-entry-unresolved'); return []; }
    return constraints.slice(1).reduce((left, right) => left.filter(a => right.some(b => overlaps(a, b))), constraints[0]);
  };
  for (const include of valueSet.compose.include) {
    for (const concept of await entry(include)) {
      if (concepts.size >= limit) { reasons.add('expansion-size-limit'); break; }
      concepts.set(identity(concept), concept);
    }
  }
  for (const exclude of valueSet.compose.exclude ?? []) {
    const excluded = await entry(exclude);
    for (const [key, concept] of concepts) if (excluded.some(c => overlaps(c, concept))) concepts.delete(key);
  }
  return { concepts: [...concepts.values()], coverage: reasons.size ? 'partial' : 'complete',
    reasons: [...reasons].sort(), source: 'compose' };
}
