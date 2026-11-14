import { providerCodeMembership, providerFilterMembership, supportsProviderFilter, type LocalTerminologyAuthority } from './built-in-terminology-provider.js';
import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';
import { createConceptFilterEvaluator, hasUnknownTerminologyModifiers, supportsLocalFilter, type ConceptMembership } from './valueset-concept-filter-membership.js';
import { codeSystemCodesEquivalent, isAssertableCodeSystem } from './valueset-code-system-rules.js';
import { assessLocalCodeSystemAuthority } from './local-code-system-authority.js';
import { finiteTerminologyAuthorityFailure } from './finite-terminology-authority.js';
import { qualifiedExpansionMembership } from './qualified-expansion-membership.js';
import type { UnverifiedBindingDiagnostic } from '../issues/unverified-binding-diagnostic.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { CodeBindingOutcome, CodeSystem, ValueSet, ValueSetComposeInclude, TerminologyUnverifiedReason } from './valueset-types.js';

type Loader = Pick<ValueSetPackageLoader, 'loadValueSetResource' | 'loadCodeSystemForValueSet'>
  & Partial<Pick<ValueSetPackageLoader, 'loadLocalTerminologyAuthority' | 'providerSnapshotForContext' | 'getComposeSystems'>>;
export type LocalFilteredBinding = { kind: 'not-applicable' }
  | { kind: 'evaluated'; outcome: CodeBindingOutcome; reason: TerminologyUnverifiedReason;
    localExpansion: UnverifiedBindingDiagnostic['localExpansion'] };
type Membership = ConceptMembership;
interface DefinitionGraph {
  definitions: Map<string, ValueSet | null>;
  selections: Map<ValueSetComposeInclude, LocalTerminologyAuthority | null>;
  entries: Array<{ vs: ValueSet; entry: ValueSetComposeInclude; candidate: boolean }>;
  editions: Set<string | undefined>;
  hasFilters: boolean;
  unsupported: boolean;
  failedLookup: boolean;
  hasLocalConcepts: boolean;
}
interface ResolutionContext {
  loader: Loader; code: string; canonical: string; fhirVersion?: FhirVersion;
  graph: DefinitionGraph; evaluateFilter: ReturnType<typeof createConceptFilterEvaluator>;
}
function entryVersion(entry: ValueSetComposeInclude): string | undefined {
  const version = entry.version ?? entry.system?.split('|')[1];
  return version === '*' ? undefined : version;
}
function union(values: Membership[]): Membership {
  return values.includes(true) ? true : values.includes(null) ? null : false;
}
function intersection(values: Membership[]): Membership {
  return values.includes(false) ? false : !values.length || values.includes(null) ? null : true;
}
function matchesDefinition(cs: CodeSystem | null, system: string, version?: string): cs is CodeSystem {
  return Boolean(cs && normalizeKnownCodeSystemCanonical(cs.url) === system
    && (!version || cs.version === version) && isAssertableCodeSystem(cs) && !modified(cs)
    && !finiteTerminologyAuthorityFailure({ ...cs, concept: [] }, 'CodeSystem', 1));
}
function modified(value: unknown): boolean {
  return hasUnknownTerminologyModifiers(value as Record<string, unknown>);
}

/** Each edition is evaluated through the complete compose before alternatives unite. */
export async function resolveUnversionedLocalFilteredBinding(
  loader: Loader, code: string, system: string | undefined, reference: string, fhirVersion?: FhirVersion,
): Promise<LocalFilteredBinding> {
  if (!loader.loadValueSetResource || !loader.loadCodeSystemForValueSet) return { kind: 'not-applicable' };
  if (!system) {
    const systems = await loader.getComposeSystems?.(reference, fhirVersion);
    if (systems?.length !== 1) return { kind: 'not-applicable' };
    system = systems[0];
  }
  const graph: DefinitionGraph = { definitions: new Map(), selections: new Map(), entries: [], editions: new Set(),
    hasFilters: false, unsupported: false, failedLookup: false, hasLocalConcepts: false };
  const context: ResolutionContext = { loader, code, canonical: normalizeKnownCodeSystemCanonical(system), fhirVersion,
    graph, evaluateFilter: createConceptFilterEvaluator() };
  await discover(context, reference, new Set(), true);
  const root = graph.definitions.get(reference);
  if (!graph.hasFilters && graph.definitions.size === 1 && root && !root.compose?.exclude?.length
    && !finiteTerminologyAuthorityFailure(root, 'ValueSet', 250_000)
    && !root.compose?.include?.some(entry => entry.valueSet?.length)
    && graph.entries.some(({ entry }) => entry.concept?.some(concept => concept.code === code))) {
    return { kind: 'not-applicable' };
  }
  let hasProvider = false;
  let hasInsensitive = context.canonical === 'urn:ietf:bcp:47';
  for (const { vs, entry, candidate } of graph.entries) {
    const version = entryVersion(entry);
    const selected = await loadDefinition(context, vs, version);
    graph.selections.set(entry, selected);
    const provider = loader.providerSnapshotForContext?.(selected, fhirVersion);
    hasProvider ||= Boolean(provider);
    hasInsensitive ||= selected?.kind === 'code-system' && selected.codeSystem.caseSensitive !== true;
    if (entry.filter?.some(filter => provider ? !supportsProviderFilter(provider, filter)
      : !supportsLocalFilter(selected?.kind === 'code-system' ? selected.codeSystem : null, filter))) graph.unsupported = true;
    if (candidate) graph.editions.add(version ?? (selected?.kind === 'code-system' ? selected.codeSystem.version : undefined));
  }
  if (!graph.hasFilters && !hasProvider && !hasInsensitive) return { kind: 'not-applicable' };
  if (!graph.editions.size) graph.editions.add(undefined);
  const membership = union(await Promise.all([...graph.editions].map(edition => matchesValueSet(context, reference, edition, new Set()))));
  return { kind: 'evaluated', outcome: membership === null ? 'unverified' : membership ? 'valid' : 'invalid',
    reason: graph.failedLookup ? 'validation-error' : graph.unsupported ? 'unsupported-filter' : 'unenumerable-system-include',
    localExpansion: graph.hasLocalConcepts ? 'incomplete' : 'none' };
}
async function discover(context: ResolutionContext, url: string, visited: Set<string>, candidatePath: boolean): Promise<void> {
  const { graph, loader, canonical, fhirVersion } = context;
  if (visited.has(url) || visited.size >= 20) { if (candidatePath) graph.editions.add(undefined); return; }
  let vs = graph.definitions.get(url);
  if (vs === undefined) {
    try { vs = await loader.loadValueSetResource(url, fhirVersion); }
    catch { graph.failedLookup = true; vs = null; }
    const [canonicalUrl, version] = url.split('|');
    if (!vs || vs.url !== canonicalUrl || (version && vs.version !== version)) vs = null;
    graph.definitions.set(url, vs);
  }
  if (!vs) { if (candidatePath) graph.editions.add(undefined); return; }
  const next = new Set(visited).add(url);
  for (const [entries, including] of [[vs.compose?.include ?? [], true], [vs.compose?.exclude ?? [], false]] as const) for (const entry of entries) {
    if (!entry || typeof entry !== 'object') { graph.hasFilters = true; graph.editions.add(undefined); continue; }
    const matchingSystem = Boolean(entry.system && normalizeKnownCodeSystemCanonical(entry.system.split('|')[0]) === canonical);
    for (const filter of entry.filter ?? []) {
      graph.hasFilters = true;
      if ((!entry.system || matchingSystem) && (!filter
        || (filter.property === 'concept' ? !supportsLocalFilter(null, filter)
          : !entry.system || !['=', 'in'].includes(filter.op)))) graph.unsupported = true;
    }
    if (matchingSystem) {
      if (entry.concept?.length) graph.hasLocalConcepts = true;
      graph.entries.push({ vs, entry, candidate: candidatePath && including });
    }
    for (const nested of entry.valueSet ?? []) await discover(context, nested, next, candidatePath && including && (!entry.system || matchingSystem));
  }
}
async function loadDefinition(context: ResolutionContext, vs: ValueSet, version?: string): Promise<LocalTerminologyAuthority | null> {
  try {
    const selected = context.loader.loadLocalTerminologyAuthority
      ? await context.loader.loadLocalTerminologyAuthority(context.canonical, context.fhirVersion, version, vs)
      : await context.loader.loadCodeSystemForValueSet(vs, context.canonical, context.fhirVersion, version)
        .then(codeSystem => codeSystem ? { kind: 'code-system' as const, codeSystem } : null);
    if (selected?.kind === 'provider') return !version && context.loader.providerSnapshotForContext?.(selected, context.fhirVersion) ? selected : null;
    const cs = selected?.codeSystem ?? null;
    if (!matchesDefinition(cs, context.canonical, version)) return null;
    if (cs.concept?.length) context.graph.hasLocalConcepts = true;
    return selected;
  } catch { context.graph.failedLookup = true; return null; }
}
async function matchesValueSet(context: ResolutionContext, url: string, edition: string | undefined, visited: Set<string>): Promise<Membership> {
  if (visited.has(url) || visited.size >= 20) return null;
  const vs = context.graph.definitions.get(url);
  if (!vs?.compose?.include?.length || modified(vs) || modified(vs.compose)) return null;
  const next = new Set(visited).add(url);
  const included = union(await Promise.all(vs.compose.include.map(entry => matchesEntry(context, vs, entry, edition, next))));
  if (included === false) return false;
  const excluded = union(await Promise.all((vs.compose.exclude ?? []).map(entry => matchesEntry(context, vs, entry, edition, next))));
  if (excluded === true) return false;
  if (included === true && excluded === false) return true;
  const authority = context.graph.entries.filter(owner => owner.vs === vs)
    .map(owner => context.graph.selections.get(owner.entry))
    .find(selected => selected?.kind === 'code-system' && selected.codeSystem.version === edition);
  return authority?.kind === 'code-system'
    ? qualifiedExpansionMembership(vs, authority.codeSystem, context.code, edition) : null;
}
async function matchesEntry(context: ResolutionContext, vs: ValueSet, entry: ValueSetComposeInclude, edition: string | undefined, visited: Set<string>): Promise<Membership> {
  if (modified(entry)) return null;
  const piped = entry.system?.split('|')[1];
  if (piped && entry.version && piped !== entry.version) return null;
  const { canonical, code, graph, evaluateFilter } = context;
  const constraints: Membership[] = [];
  const pinned = entryVersion(entry);
  if (entry.system) {
    if (normalizeKnownCodeSystemCanonical(entry.system.split('|')[0]) !== canonical) return false;
    if (pinned && edition && pinned !== edition) return false;
    if (pinned && !edition) constraints.push(null);
    let selected = graph.selections.get(entry) ?? null;
    // An unpinned clause must speak for this edition in its own source scope.
    if (edition && !pinned && (selected?.kind !== 'code-system' || selected.codeSystem.version !== edition))
      selected = await loadDefinition(context, vs, edition);
    const cs = selected?.kind === 'code-system' ? selected.codeSystem : null;
    const usable = matchesDefinition(cs, canonical, pinned ?? edition) ? cs : null;
    if (entry.concept?.length) constraints.push(entry.concept.some(concept =>
      codeSystemCodesEquivalent(concept.code, code, usable ? usable.caseSensitive : true, canonical)));
    const provider = !pinned && !edition ? context.loader.providerSnapshotForContext?.(selected, context.fhirVersion) : null;
    if (!entry.concept?.length && !entry.filter?.length) {
      const authority = usable ? assessLocalCodeSystemAuthority(usable, code) : null;
      constraints.push(provider ? providerCodeMembership(provider, code) : authority?.kind === 'present' ? true
        : authority?.kind === 'absent' && authority.complete ? false : null);
    }
    for (const filter of entry.filter ?? []) constraints.push(provider ? providerFilterMembership(provider, code, filter)
      : usable ? evaluateFilter(usable, code, filter) : null);
  } else if (entry.concept?.length || entry.version || entry.filter?.length) constraints.push(null);
  for (const nested of entry.valueSet ?? []) constraints.push(await matchesValueSet(context, nested, edition, visited));
  return intersection(constraints);
}
