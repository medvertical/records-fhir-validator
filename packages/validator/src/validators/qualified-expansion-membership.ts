import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';
import { assessStoredExpansion, hasNonEnumerableCodeGrammar } from './finite-valueset-expansion.js';
import { codeSystemCodesEquivalent } from './valueset-code-system-rules.js';
import type { CodeSystem, ValueSet } from './valueset-types.js';

/** A complete captured expansion can answer a filter without claiming complete concept properties. */
export function qualifiedExpansionMembership(valueSet: ValueSet, codeSystem: CodeSystem,
  code: string, version: string | undefined): boolean | null {
  if (!version || codeSystem.version !== version || typeof codeSystem.caseSensitive !== 'boolean') return null;
  // This fallback has no nested definition resolver to establish expression closure.
  if (hasNonEnumerableCodeGrammar(codeSystem)
    && [...(valueSet.compose?.include ?? []), ...(valueSet.compose?.exclude ?? [])].some(entry => entry.valueSet?.length)) return null;
  const expansion = assessStoredExpansion(valueSet, undefined, [codeSystem]);
  if (expansion?.coverage !== 'complete') return null;
  const canonical = normalizeKnownCodeSystemCanonical(codeSystem.url);
  const concepts = expansion.concepts.filter(concept => concept.system
    && normalizeKnownCodeSystemCanonical(concept.system) === canonical);
  if (concepts.some(concept => !concept.version)) return null;
  const declared = new Set<string>();
  for (const parameter of valueSet.expansion?.parameter ?? []) {
    if (!['system-version', 'check-system-version'].includes(parameter.name)) continue;
    const value = parameter.valueUri ?? parameter.valueString;
    if (typeof value !== 'string') return null;
    const [system, edition, extra] = value.split('|');
    if (normalizeKnownCodeSystemCanonical(system) !== canonical) continue;
    if (!edition || extra !== undefined) return null;
    declared.add(edition);
  }
  if (declared.size && concepts.some(concept => !declared.has(concept.version!))) return null;
  if (!concepts.some(concept => concept.version === version) && !declared.has(version)) return null;
  return concepts.some(concept => concept.version === version
    && codeSystemCodesEquivalent(concept.code, code, codeSystem.caseSensitive, canonical));
}
