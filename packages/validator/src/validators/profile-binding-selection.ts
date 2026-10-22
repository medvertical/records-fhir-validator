import type { ValidationIssue } from '@records-fhir/validation-types';
import type { Binding, ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import { matchesDefinitionInstancePath } from '../core/choice-type-path.js';
import { resolveFhirSegmentElement } from '../core/fhir-primitive-sidecar.js';
import { createValidationIssue } from '../issues/issue-factory.js';
import { extractSlicingInfo } from './slice-info-extractor.js';
import { assessElementSliceMembership } from './slicing-match-policy.js';
import { prepareProfileBindingSlicingBases } from './profile-binding-slicing-bases.js';
import { AsyncLocalStorage } from 'node:async_hooks';

type FhirVersion = 'R4' | 'R5' | 'R6';
export interface SelectedProfileBinding { binding: Binding | undefined; issues: ValidationIssue[] }
type Membership = 'matched' | 'nonmember' | 'unknown' | 'ambiguous';
interface BindingSelectionContext {
  profile?: StructureDefinition;
  rootResource?: unknown;
  basePath: string;
  value: unknown;
  fhirVersion: FhirVersion;
  loader: StructureDefinitionLoader;
}

type BindingDefinitions = ReturnType<typeof prepareBindingDefinitions>;
interface BindingPathMatches { candidates: ElementDefinition[]; duplicateBindings: ElementDefinition[] }
const invocationDefinitions = new AsyncLocalStorage<WeakMap<StructureDefinition, Map<FhirVersion, BindingDefinitions>>>();

/** Only definition indexes are shared; resolved dependencies and occurrence proofs remain selector-local. */
export function withProfileBindingPreparation<T>(validate: () => Promise<T>): Promise<T> {
  return invocationDefinitions.run(new WeakMap(), validate);
}

/** Prepared definitions are invocation-local; occurrence membership is never cached by an indexless path. */
export function createProfileBindingSelector(context: BindingSelectionContext) {
  let prepared: ReturnType<typeof prepareProfileBindingSelector> | undefined;
  return (baseBinding: Binding | undefined, fullPath: string): Promise<SelectedProfileBinding> => {
    prepared ??= prepareProfileBindingSelector(context);
    return prepared(baseBinding, fullPath);
  };
}

function prepareBindingDefinitions(context: BindingSelectionContext) {
  const preparedBases = prepareProfileBindingSlicingBases(context.profile, context.fhirVersion);
  const elements = preparedBases.elements;
  const preparedProfile = context.profile && elements !== context.profile.snapshot?.element
    ? { ...context.profile, snapshot: { ...context.profile.snapshot, element: elements } } : context.profile;
  const duplicateIds = new Set<string>();
  const byId = new Map<string, ElementDefinition>();
  for (const element of elements) {
    if (!element.id) continue;
    if (byId.has(element.id)) duplicateIds.add(element.id);
    byId.set(element.id, element);
  }
  const bindings = elements.filter(element => element.binding);
  return { preparedBases, elements, preparedProfile, duplicateIds, byId, bindings,
    matchesByPath: new Map<string, BindingPathMatches>() };
}

function matchingBindings(definitions: BindingDefinitions, fullPath: string): BindingPathMatches {
  const path = fullPath.replace(/\[\d+\]/g, '');
  const cached = definitions.matchesByPath.get(path);
  if (cached) return cached;
  const matches: BindingPathMatches = { candidates: [], duplicateBindings: [] };
  for (const element of definitions.bindings) {
    const sliced = element.id?.includes(':');
    const duplicate = element.id && definitions.duplicateIds.has(element.id);
    if ((!sliced && !duplicate) || !matchesDefinitionInstancePath(element.path, path, definitions.elements)) continue;
    if (sliced) matches.candidates.push(element);
    if (duplicate) matches.duplicateBindings.push(element);
  }
  // Bound untrusted path cardinality without retaining occurrence values or membership proofs.
  if (definitions.matchesByPath.size < 1024) definitions.matchesByPath.set(path, matches);
  return matches;
}

function bindingDefinitions(context: BindingSelectionContext): BindingDefinitions {
  const scope = invocationDefinitions.getStore();
  if (!scope || !context.profile) return prepareBindingDefinitions(context);
  let byVersion = scope.get(context.profile);
  if (!byVersion) { byVersion = new Map(); scope.set(context.profile, byVersion); }
  let definitions = byVersion.get(context.fhirVersion);
  if (!definitions) { definitions = prepareBindingDefinitions(context); byVersion.set(context.fhirVersion, definitions); }
  return definitions;
}

function prepareProfileBindingSelector(context: BindingSelectionContext) {
  const definitions = bindingDefinitions(context);
  const { preparedBases, elements, preparedProfile, duplicateIds, byId } = definitions;
  const groups = new Map<string, ReturnType<typeof extractSlicingInfo>>();
  const siblingsByPath = new Map<string, ElementDefinition[]>();
  let lastProfileUrl: string | undefined;
  let lastProfile: StructureDefinition | null = null;
  let latestRead = 0;
  const loadProfile = async (url: string): Promise<StructureDefinition | null> => {
    if (url === lastProfileUrl && lastProfile) return lastProfile;
    lastProfileUrl = url;
    lastProfile = null;
    const read = ++latestRead;
    const profile = await context.loader.loadReferencedProfile(url, context.profile, context.fhirVersion);
    // Concurrent selectors must not let an older read replace newer evidence.
    if (read === latestRead && profile) lastProfile = profile;
    return profile;
  };
  const prepare = (base: ElementDefinition) => {
    let pending = groups.get(base.id!);
    if (!pending) {
      pending = extractSlicingInfo(base.path, preparedProfile!,
        loadProfile, null, base.id);
      groups.set(base.id!, pending);
    }
    return pending;
  };
  const membership = async (id: string, fullPath: string): Promise<Membership> => {
    const slice = byId.get(id); const baseId = slicingBaseId(id); const base = byId.get(baseId);
    if (preparedBases.ambiguousBaseIds.has(baseId) || duplicateIds.has(id) || duplicateIds.has(baseId) || !slice?.sliceName || !base?.slicing?.discriminator?.length) return 'unknown';
    const node = instanceNode(context, slice.path, fullPath);
    if (node === undefined) return 'unknown';
    const info = await prepare(base);
    if (!info || info.slicing.discriminator?.length !== base.slicing.discriminator.length) return 'unknown';
    const siblingKey = JSON.stringify([baseId, slice.path]);
    let siblings = siblingsByPath.get(siblingKey);
    if (!siblings) {
      siblings = elements.filter(element => element.path === slice.path && element.sliceName
        && element.id && slicingBaseId(element.id) === baseId);
      siblingsByPath.set(siblingKey, siblings);
    }
    const names = new Set(siblings.map(element => element.sliceName));
    const prepared = info.slices.filter(candidate => names.has(candidate.sliceName));
    if (prepared.length !== siblings.length || new Set(prepared.map(candidate => candidate.sliceName)).size !== prepared.length) return 'unknown';
    const proof = assessElementSliceMembership(node, prepared, info.slicing, null);
    if (proof.state === 'ambiguous') return 'ambiguous';
    if (proof.unknownSlices.length || proof.state === 'unknown') return 'unknown';
    return proof.state === 'matched' && proof.matchedSlices.some(candidate => candidate.sliceName === slice.sliceName)
      ? 'matched' : 'nonmember';
  };
  return async (baseBinding: Binding | undefined, fullPath: string): Promise<SelectedProfileBinding> => {
    const { candidates, duplicateBindings } = matchingBindings(definitions, fullPath);
    if (!candidates.length && !duplicateBindings.length) return { binding: baseBinding, issues: [] };
    const selected: ElementDefinition[] = [];
    const unresolved: { id: string; state: Membership }[] = duplicateBindings.map(element => ({ id: element.id!, state: 'unknown' }));
    for (const candidate of candidates) {
      const chain = duplicateIds.has(candidate.id!) ? [] : sliceAncestors(candidate.id!, byId);
      if (!chain.length) { unresolved.push({ id: candidate.id!, state: 'unknown' }); continue; }
      let state: Membership = 'matched';
      for (const id of chain) {
        state = await membership(id, fullPath);
        if (state !== 'matched') break;
      }
      if (state === 'matched') selected.push(candidate);
      else if (state !== 'nonmember') unresolved.push({ id: candidate.id!, state });
    }
    const deepest = selected.filter(candidate => !selected.some(other => other !== candidate
      && isDescendantBinding(other.id!, candidate.id!)));
    if (unresolved.length || deepest.length > 1) return { binding: undefined, issues: [createValidationIssue({
      code: 'terminology-binding-unverified', path: fullPath, resourceType: fullPath.split('.')[0], profile: context.profile?.url,
      customMessage: 'The effective binding could not be selected because slice membership is unverified or ambiguous.',
      severityOverride: 'information', details: { validationComplete: false, validationStatus: 'incomplete',
        reason: 'binding-slice-membership-unverified', candidateElementIds: candidates.map(candidate => candidate.id),
        unresolvedSlices: unresolved, conflictingElementIds: deepest.length > 1 ? deepest.map(candidate => candidate.id) : [] },
    })] };
    let binding = baseBinding;
    if (deepest[0]) {
      const chain = selected.filter(element => element === deepest[0] || isDescendantBinding(deepest[0].id!, element.id!))
        .sort((first, second) => first.id!.split(/[/:]/).length - second.id!.split(/[/:]/).length);
      for (const element of chain) {
        if (element.binding) binding = { ...binding, ...element.binding };
      }
    }
    return { binding, issues: [] };
  };
}

function slicingBaseId(sliceId: string): string {
  const segmentStart = sliceId.lastIndexOf('.') + 1;
  const slash = sliceId.lastIndexOf('/');
  return slash >= segmentStart ? sliceId.slice(0, slash) : sliceId.slice(0, sliceId.lastIndexOf(':'));
}
function sliceAncestors(id: string, definitions: Map<string, ElementDefinition>): string[] {
  const chain: string[] = []; const segments = id.split('.');
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]; const colon = segment.indexOf(':');
    if (colon < 0) continue;
    const prefix = [...segments.slice(0, index), segment.slice(0, colon)].join('.');
    const labels = segment.slice(colon + 1).split('/');
    for (let end = 1; end <= labels.length; end++) {
      const sliceId = `${prefix}:${labels.slice(0, end).join('/')}`;
      if (!definitions.get(sliceId)?.sliceName) return [];
      chain.push(sliceId);
    }
  }
  return chain;
}
function isDescendantBinding(child: string, parent: string): boolean {
  const childSegments = child.split('.'); const parentSegments = parent.split('.');
  return child !== parent && childSegments.length === parentSegments.length && childSegments.every((segment, index) =>
    segment === parentSegments[index] || segment.startsWith(`${parentSegments[index]}/`)
      || (!parentSegments[index].includes(':') && segment.startsWith(`${parentSegments[index]}:`)));
}
function instanceNode(context: BindingSelectionContext, definitionPath: string, fullPath: string): unknown {
  const segments = fullPath.split('.').slice(0, definitionPath.split('.').length);
  const occurrencePath = segments.join('.');
  if (context.rootResource !== undefined) return traverse(context.rootResource, segments.slice(1));
  if (occurrencePath === context.basePath) return context.value;
  if (!occurrencePath.startsWith(`${context.basePath}.`)) return undefined;
  return traverse(context.value, occurrencePath.slice(context.basePath.length + 1).split('.'));
}
function traverse(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const segment of segments) {
    const indexed = /^(.*)\[(\d+)\]$/.exec(segment);
    current = resolveFhirSegmentElement(current, indexed?.[1] ?? segment);
    if (indexed) current = Array.isArray(current) ? current[Number(indexed[2])] : undefined;
    if (current === undefined || Array.isArray(current)) return undefined;
  }
  return current;
}
