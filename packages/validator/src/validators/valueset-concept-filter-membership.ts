import { findImportedInventoryConcept } from './imported-terminology-inventory.js';
import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';
import type { CodeSystem, ValueSetComposeInclude } from './valueset-types.js';
import { canMatchDeclaredPropertyEquality, propertyFilterMembership } from './valueset-property-filter-membership.js';

export type ConceptMembership = boolean | null;
type Filter = NonNullable<ValueSetComposeInclude['filter']>[number];
type RecordValue = Record<string, unknown>;
interface Hierarchy {
  concepts: Map<string, RecordValue>;
  ambiguous: Set<string>;
  children: Map<string, Set<string>>;
  closed: boolean;
}
const propertyPrefix = 'http://hl7.org/fhir/concept-properties#';
const annotationExtensions = new Set(['structuredefinition-wg', 'structuredefinition-fmm',
  'structuredefinition-standards-status', 'structuredefinition-normative-version']
  .map(name => `http://hl7.org/fhir/StructureDefinition/${name}`));
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : undefined;
}
function hasUnknownExtensions(value: RecordValue): boolean {
  if (value.extension === undefined) return false;
  return !Array.isArray(value.extension) || value.extension.some(extension => {
    const entry = record(extension);
    return !entry || typeof entry.url !== 'string' || !annotationExtensions.has(entry.url);
  });
}
export function hasUnknownTerminologyModifiers(raw: unknown): boolean {
  const value = record(raw);
  if (!value) return true;
  return value.implicitRules !== undefined || (value.modifierExtension !== undefined
    && (!Array.isArray(value.modifierExtension) || value.modifierExtension.length > 0));
}

export function supportsLocalFilter(codeSystem: CodeSystem | null, filter: Filter): boolean {
  if (!record(filter) || hasUnknownTerminologyModifiers(filter)) return false;
  if (filter.property === 'concept') return ['=', 'is-a', 'descendent-of', 'is-not-a'].includes(filter.op);
  return Boolean(codeSystem && !hasUnknownTerminologyModifiers(codeSystem)
    && canMatchDeclaredPropertyEquality(codeSystem, filter, hasUnknownTerminologyModifiers));
}

/** Closed complements need complete authority; positive paths/facts need their own trustworthy witness. */
export function conceptFilterMembership(codeSystem: CodeSystem, code: string, filter: Filter): ConceptMembership {
  return createConceptFilterEvaluator()(codeSystem, code, filter);
}
export function createConceptFilterEvaluator(): typeof conceptFilterMembership {
  const hierarchies = new Map<CodeSystem, Hierarchy>();
  return (codeSystem, code, filter) => {
    if (!supportsLocalFilter(codeSystem, filter) || codeSystem.content === 'not-present' || codeSystem.content === 'supplement'
      || hasUnknownTerminologyModifiers(codeSystem)) return null;
    if (filter.property === 'concept' && filter.op === '=') {
      const own = findImportedInventoryConcept(codeSystem, code);
      if (own !== undefined) return own && findImportedInventoryConcept(codeSystem, filter.value) ? code === filter.value : null;
    }
    let hierarchy = hierarchies.get(codeSystem);
    if (!hierarchy) { hierarchy = buildHierarchy(codeSystem); hierarchies.set(codeSystem, hierarchy); }
    if (filter.property === 'concept') return evaluateHierarchy(hierarchy, code, filter);
    return hierarchy.ambiguous.has(code) ? null
      : propertyFilterMembership(codeSystem, hierarchy.concepts.get(code), filter, hasUnknownTerminologyModifiers);
  };
}
function evaluateHierarchy(hierarchy: Hierarchy, code: string, filter: Filter): ConceptMembership {
  if (!hierarchy.concepts.has(code) || !hierarchy.concepts.has(filter.value)
    || hierarchy.ambiguous.has(code) || hierarchy.ambiguous.has(filter.value)) return null;
  if (filter.op === '=') return code === filter.value;
  if (code === filter.value) return filter.op === 'is-a';
  if (reachable(hierarchy.children, filter.value, code)) return filter.op !== 'is-not-a';
  return hierarchy.closed ? filter.op === 'is-not-a' : null;
}

function buildHierarchy(codeSystem: CodeSystem): Hierarchy {
  const hierarchy: Hierarchy = { concepts: new Map(), ambiguous: new Set(), children: new Map(),
    closed: codeSystem.content === 'complete' && codeSystem.hierarchyMeaning === 'is-a'
      && !hasUnknownExtensions(codeSystem as unknown as RecordValue) };
  const nestedEdges: Array<[string, string]> = [];
  const pending: Array<{ concepts: unknown; parent?: string; modified?: boolean }> = [{ concepts: codeSystem.concept }];
  const observed = new Set<object>();
  while (pending.length > 0) {
    const batch = pending.pop()!;
    if (!Array.isArray(batch.concepts)) { hierarchy.closed = false; continue; }
    for (const raw of batch.concepts) {
      const concept = record(raw);
      if (!concept || typeof concept.code !== 'string' || !concept.code) {
        hierarchy.closed = false; continue;
      }
      if (observed.has(concept)) { markRepeatedSubtree(concept, hierarchy); hierarchy.closed = false; continue; }
      observed.add(concept);
      if (hierarchy.concepts.has(concept.code)) hierarchy.ambiguous.add(concept.code);
      else hierarchy.concepts.set(concept.code, concept);
      const modified = batch.modified || hasUnknownTerminologyModifiers(concept);
      if (modified) hierarchy.ambiguous.add(concept.code);
      if (hasUnknownExtensions(concept)) hierarchy.closed = false;
      if (batch.parent) nestedEdges.push([batch.parent, concept.code]);
      if (concept.concept !== undefined) pending.push({ concepts: concept.concept, parent: concept.code, modified });
    }
  }
  if (codeSystem.caseSensitive !== true) markCaseAmbiguity(hierarchy);
  if (hierarchy.ambiguous.size > 0) hierarchy.closed = false;
  if (codeSystem.hierarchyMeaning !== 'is-a') return hierarchy;
  const definitions = propertyDefinitions(codeSystem, hierarchy);
  for (const [parent, child] of nestedEdges) addEdge(hierarchy, parent, child);
  for (const [code, concept] of hierarchy.concepts) {
    if (concept.property === undefined) continue;
    if (!Array.isArray(concept.property)) { hierarchy.closed = false; continue; }
    for (const raw of concept.property) {
      const property = record(raw);
      if (!property || typeof property.code !== 'string') { hierarchy.closed = false; continue; }
      const definition = definitions.get(property.code);
      if (!definition) { hierarchy.closed = false; continue; }
      const direction = relationshipDirection(definition, property.code);
      if (!direction) continue;
      const target = relationTarget(property, definition, codeSystem);
      if (!target) { hierarchy.closed = false; continue; }
      addEdge(hierarchy, direction === 'parent' ? target : code, direction === 'parent' ? code : target);
    }
  }
  // Cyclic representations are not a closed authority this evaluator can complement.
  // This is a capability guard, not a claim that every FHIR hierarchy must be a DAG.
  if (containsCycle(hierarchy.children)) hierarchy.closed = false;
  return hierarchy;
}
function markRepeatedSubtree(concept: RecordValue, hierarchy: Hierarchy): void {
  const pending = [concept];
  const visited = new Set<object>();
  while (pending.length) {
    const next = pending.pop()!;
    if (visited.has(next)) continue;
    visited.add(next);
    if (typeof next.code === 'string') hierarchy.ambiguous.add(next.code);
    if (Array.isArray(next.concept)) for (const raw of next.concept) {
      const child = record(raw);
      if (child) pending.push(child);
    }
  }
}
function markCaseAmbiguity(hierarchy: Hierarchy): void {
  const folded = new Map<string, string>();
  for (const code of hierarchy.concepts.keys()) {
    const key = code.toLowerCase();
    const previous = folded.get(key);
    if (previous !== undefined && previous !== code) {
      hierarchy.ambiguous.add(previous); hierarchy.ambiguous.add(code);
    } else folded.set(key, code);
  }
}
function propertyDefinitions(codeSystem: CodeSystem, hierarchy: Hierarchy): Map<string, RecordValue> {
  const definitions = new Map<string, RecordValue>();
  if (codeSystem.property === undefined) return definitions;
  if (!Array.isArray(codeSystem.property)) { hierarchy.closed = false; return definitions; }
  const duplicates = new Set<string>();
  for (const raw of codeSystem.property) {
    const definition = record(raw);
    if (!definition || typeof definition.code !== 'string') { hierarchy.closed = false; continue; }
    if (hasUnknownTerminologyModifiers(definition) || hasUnknownExtensions(definition)) {
      duplicates.add(definition.code); hierarchy.closed = false; continue;
    }
    if (definitions.has(definition.code)) { duplicates.add(definition.code); hierarchy.closed = false; }
    else definitions.set(definition.code, definition);
    if (['parent', 'child'].includes(definition.code) && definition.uri !== undefined
      && definition.uri !== `${propertyPrefix}${definition.code}`) hierarchy.closed = false;
  }
  for (const duplicate of duplicates) definitions.delete(duplicate);
  return definitions;
}
function relationshipDirection(definition: RecordValue | undefined, code: string): 'parent' | 'child' | undefined {
  if (definition?.uri === `${propertyPrefix}parent`) return 'parent';
  if (definition?.uri === `${propertyPrefix}child`) return 'child';
  if (code === 'parent' || code === 'child') return code;
  return undefined;
}
function relationTarget(property: RecordValue, definition: RecordValue | undefined, codeSystem: CodeSystem): string | undefined {
  if (!definition || (definition.uri !== undefined && definition.uri !== `${propertyPrefix}parent`
    && definition.uri !== `${propertyPrefix}child`)) return undefined;
  const fields = Object.keys(property).filter(key => key.startsWith('value') && property[key] !== undefined);
  if (fields.length !== 1 || hasUnknownTerminologyModifiers(property) || hasUnknownExtensions(property)) return undefined;
  if (definition.type === 'code' && fields[0] === 'valueCode') {
    return typeof property.valueCode === 'string' && property.valueCode ? property.valueCode : undefined;
  }
  if (definition.type !== 'Coding' || fields[0] !== 'valueCoding') return undefined;
  const coding = record(property.valueCoding);
  if (!coding || typeof coding.system !== 'string' || typeof coding.code !== 'string' || !coding.code
    || normalizeKnownCodeSystemCanonical(coding.system) !== normalizeKnownCodeSystemCanonical(codeSystem.url)
    || (coding.version !== undefined && coding.version !== codeSystem.version)
    || hasUnknownTerminologyModifiers(coding) || hasUnknownExtensions(coding)) return undefined;
  return coding.code;
}
function addEdge(hierarchy: Hierarchy, parent: string, child: string): void {
  if (!hierarchy.concepts.has(parent) || !hierarchy.concepts.has(child)
    || hierarchy.ambiguous.has(parent) || hierarchy.ambiguous.has(child)) {
    hierarchy.closed = false; return;
  }
  const children = hierarchy.children.get(parent) ?? new Set<string>();
  children.add(child); hierarchy.children.set(parent, children);
}
function reachable(edges: Map<string, Set<string>>, root: string, code: string): boolean {
  const pending = [...(edges.get(root) ?? [])];
  const visited = new Set<string>([root]);
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (next === code) return true;
    if (visited.has(next)) continue;
    visited.add(next); pending.push(...(edges.get(next) ?? []));
  }
  return false;
}
function containsCycle(edges: Map<string, Set<string>>): boolean {
  const indegree = new Map<string, number>();
  for (const [parent, children] of edges) {
    if (!indegree.has(parent)) indegree.set(parent, 0);
    for (const child of children) indegree.set(child, (indegree.get(child) ?? 0) + 1);
  }
  const pending = [...indegree].filter(([, count]) => count === 0).map(([code]) => code);
  let removed = 0;
  while (pending.length > 0) {
    const parent = pending.pop()!; removed++;
    for (const child of edges.get(parent) ?? []) {
      const count = indegree.get(child)! - 1; indegree.set(child, count);
      if (count === 0) pending.push(child);
    }
  }
  return removed < indegree.size;
}
