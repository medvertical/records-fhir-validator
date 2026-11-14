import { assessFiniteCodeSystem } from './finite-valueset-expansion.js';
import { finiteTerminologyAuthorityFailure } from './finite-terminology-authority.js';
import { hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';
import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';
import { codeSystemCodesEquivalent } from './valueset-code-system-rules.js';

type Assessment = { kind: 'present'; concept: CodeSystemConcept }
  | { kind: 'absent'; complete: boolean }
  | { kind: 'unverified' };
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;

/** Presence needs usable local facts; absence additionally needs a closed, qualified inventory. */
export function assessLocalCodeSystemAuthority(codeSystem: CodeSystem, code: string): Assessment {
  if (finiteTerminologyAuthorityFailure({ ...codeSystem, concept: [] }, 'CodeSystem', 1)
    || !['complete', 'fragment', 'example'].includes(codeSystem.content ?? '')
    || codeSystem.property !== undefined && (!Array.isArray(codeSystem.property)
      || codeSystem.property.some(property => !record(property) || typeof property.code !== 'string'))) return { kind: 'unverified' };
  const found = findUsableConcept(codeSystem.concept, code, codeSystem.caseSensitive, codeSystem.url);
  if (found.kind !== 'absent') return found;
  const inventory = codeSystem.concept === undefined && codeSystem.count === 0 ? { ...codeSystem, concept: [] } : codeSystem;
  return { kind: 'absent', complete: assessFiniteCodeSystem(inventory).coverage === 'complete' };
}

function findUsableConcept(input: unknown, code: string, caseSensitive?: boolean, system?: string): Assessment {
  if (input === undefined) return { kind: 'absent', complete: false };
  if (!Array.isArray(input)) return { kind: 'unverified' };
  const pending: Array<{ nodes: unknown[]; offset: number }> = [{ nodes: input, offset: 0 }];
  const seen = new WeakSet<object>();
  let selected: CodeSystemConcept | undefined;
  let visited = 0;
  while (pending.length) {
    const frame = pending[pending.length - 1];
    if (frame.offset === frame.nodes.length) { pending.pop(); continue; }
    if (++visited > 1_000_000 || pending.length > 128) return { kind: 'unverified' };
    const concept = record(frame.nodes[frame.offset++]);
    if (!concept || seen.has(concept)) return { kind: 'unverified' };
    seen.add(concept);
    if (hasUnknownTerminologyModifiers(concept)) return { kind: 'unverified' };
    if (typeof concept.code === 'string' && codeSystemCodesEquivalent(concept.code, code, caseSensitive, system)) {
      if (selected) return { kind: 'unverified' };
      const failure = finiteTerminologyAuthorityFailure({ url: 'urn:local:concept-shape',
        concept: [{ ...concept, concept: undefined }] }, 'CodeSystem', 1);
      if (failure || !usableProperties(concept.property)) return { kind: 'unverified' };
      selected = concept as unknown as CodeSystemConcept;
    }
    if (concept.concept !== undefined) {
      if (!Array.isArray(concept.concept)) return { kind: 'unverified' };
      pending.push({ nodes: concept.concept, offset: 0 });
    }
  }
  return selected ? { kind: 'present', concept: selected } : { kind: 'absent', complete: false };
}

function usableProperties(input: unknown): boolean {
  if (input === undefined) return true;
  return Array.isArray(input) && input.every(raw => {
    const property = record(raw);
    return !!property && typeof property.code === 'string' && !hasUnknownTerminologyModifiers(property)
      && Object.keys(property).filter(key => key.startsWith('value') && property[key] !== undefined).length === 1
      && (property.valueCode === undefined || typeof property.valueCode === 'string')
      && (property.valueString === undefined || typeof property.valueString === 'string')
      && (property.valueBoolean === undefined || typeof property.valueBoolean === 'boolean');
  });
}
