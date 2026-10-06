import { sliceInstanceEvidence } from './slice-instance-evidence.js';
import { classifyConstraintResult } from './constraint-result-policy.js';
import fhirpath from 'fhirpath';
import { isFhirResource } from '../core/fhir-resource.js';
import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { focusResourceOf } from './sd-fhirpath-focus-resource.js';
import type { FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import type { ElementDefinition, SlicingDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { isConcreteChoiceProperty } from '../core/fhir-choice-property.js';
import { getInvariantFhirPathModel } from '../core/fhirpath-context.js';
import { extractFixedEntry, extractPatternEntry } from './slice-constraint-values.js';
import { valueMatchesFixedConstraint } from './slice-fixed-value-matching.js';
import { matchesPattern } from './slice-pattern-matching.js';
import { getValueAtPath } from './slice-path-resolution.js';
import { getTypeSpecsForDiscriminator, typeCodeMatchesValue } from './slice-type-discriminator.js';
import type { SliceDefinition } from './slice-types.js';

type ResolvedProfile = Pick<StructureDefinition, 'type' | 'snapshot'>;
type ProfileResolverFn = (profileUrl: string) => Promise<ResolvedProfile | null>;

export interface SliceProfileConformanceContext {
  fhirVersion?: FhirVersionFamily;
  rootResource?: unknown;
  elementPath?: string;
}

/**
 * Datatypes carry no meta.profile. Each profile alternative must hold its
 * own cardinalities, fixed/pattern values, and invariants; an unavailable
 * alternative remains unknown. The slicing invocation isolates this evidence.
 */

export async function prepareDatatypeProfileConformance(
  elements: unknown[],
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolveProfile: ProfileResolverFn | null,
  context: SliceProfileConformanceContext = {},
): Promise<void> {
  const byProfileAtThis = (slicing.discriminator ?? [])
    .some(discriminator => discriminator.type === 'profile' && (discriminator.path || '$this') === '$this');
  const values = elements.filter((element): element is Record<string, unknown> =>
    isRecord(element) && typeof element.resourceType !== 'string');
  if (!resolveProfile || !byProfileAtThis || values.length === 0) return;

  const unavailableSlices = new Set<string>();
  const profilesBySlice = new Map<string, Array<Pick<StructureDefinition, 'snapshot'>>>();
  for (const slice of slices) {
    const urls = getTypeSpecsForDiscriminator(slice, '$this').flatMap(spec => spec.profile ?? []);
    if (urls.length === 0) { unavailableSlices.add(slice.sliceName); continue; }
    const profiles = await Promise.all(urls.map(url => resolveProfile(url).catch(() => null)));
    if (profiles.some(profile => !profile?.snapshot?.element?.length)) unavailableSlices.add(slice.sliceName);
    profilesBySlice.set(slice.sliceName, profiles.filter((profile): profile is ResolvedProfile => Boolean(profile?.snapshot?.element?.length)));
  }
  for (const value of values) {
    const memberships = new Map(slices.map(slice => [slice.sliceName, profileConformance(
      value, profilesBySlice.get(slice.sliceName) ?? [], context, unavailableSlices.has(slice.sliceName),
    )]));
    const evidence = sliceInstanceEvidence();
    evidence.conformingSlices.delete(value);
    evidence.partialProfileMembership.delete(value);
    if ([...memberships.values()].some(state => state === undefined)) {
      evidence.partialProfileMembership.set(value, memberships);
    } else evidence.conformingSlices.set(value, new Set([...memberships]
      .filter(([, state]) => state === true).map(([sliceName]) => sliceName)));
  }
}

/**
 * A resource that declares none of the slices' profiles is placed the same
 * way where two slices admit its type: IHE MHD's SubmissionSet and Folder
 * entries are both Lists, told apart by the code each profile fixes. A slice
 * that admits the type without a readable profile decides nothing.
 */
export async function prepareResourceProfileConformance(
  elements: unknown[],
  slices: SliceDefinition[],
  path: string,
  resolveProfile: ProfileResolverFn,
  context: SliceProfileConformanceContext = {},
): Promise<void> {
  const resources = elements
    .flatMap(element => [getValueAtPath(element, path) ?? []].flat())
    .filter((value): value is Record<string, unknown> => isRecord(value) && typeof value.resourceType === 'string');
  if (resources.length === 0) return;

  const admitting = await Promise.all(slices.map(async slice => {
    const specs = getTypeSpecsForDiscriminator(slice, path);
    const urls = specs.flatMap(spec => spec.profile ?? []);
    const profiles = await Promise.all(urls.map(url => resolveProfile(url).catch(() => null)));
    return { sliceName: slice.sliceName, codes: specs.map(spec => spec.code), profiles };
  }));
  if (admitting.some(slice => slice.profiles.some(profile => !profile?.snapshot?.element?.length))) return;

  for (const resource of resources) {
    const candidates = admitting.filter(slice => slice.codes.includes(resource.resourceType as string)
      || slice.profiles.some(profile => profile?.type === resource.resourceType));
    if (candidates.length === 0 || candidates.some(slice => slice.profiles.length === 0)) continue;
    const ofType = (slice: typeof candidates[number]) =>
      slice.profiles.filter((profile): profile is ResolvedProfile => profile?.type === resource.resourceType);
    const memberships = candidates.map(slice => [slice.sliceName, profileConformance(
      resource, ofType(slice), context, slice.profiles.some(profile =>
        !profile?.type || profile.type === 'Resource' || profile.type === 'DomainResource'),
    )] as const);
    const evidence = sliceInstanceEvidence();
    evidence.conformingSlices.delete(resource);
    evidence.partialProfileMembership.delete(resource);
    if (memberships.some(([, state]) => state === undefined)) {
      const partial = new Map<string, boolean | undefined>(memberships);
      for (const slice of admitting) {
        if (!partial.has(slice.sliceName) && slice.profiles.length > 0 && slice.profiles.every(profile =>
          typeof profile?.type === 'string' && profile.type !== resource.resourceType
          && typeCodeMatchesValue('Resource', profile.type, { resourceType: profile.type }))) {
          partial.set(slice.sliceName, false);
        }
      }
      evidence.partialProfileMembership.set(resource, partial);
      continue;
    }
    evidence.conformingSlices.set(resource, new Set(memberships
      .filter(([, state]) => state === true).map(([sliceName]) => sliceName)));
  }
}

/** The slices whose datatype profile this value conforms to, when that could be decided. */
export function datatypeConformingSlices(value: unknown): ReadonlySet<string> | undefined {
  return isRecord(value) ? sliceInstanceEvidence().conformingSlices.get(value) : undefined;
}

export function localDatatypeConstraintsReject(value: unknown, elements: ElementDefinition[]): boolean {
  return isRecord(value) && !conformsTo(value, { snapshot: { element: elements } });
}

function conformsTo(value: Record<string, unknown>, profile: Pick<StructureDefinition, 'snapshot'>): boolean {
  const elements = profile.snapshot?.element ?? [];
  const root = elements[0]?.path ?? '';
  return elements.every((element, index) => element.id?.includes(':')
    || ((index === 0 || withinCardinality(value, element, root)) && holdsFixedValue(value, element, root)));
}

function withinCardinality(value: Record<string, unknown>, element: ElementDefinition, root: string): boolean {
  const segments = segmentsBelow(root, element.path);
  const name = segments.pop() ?? '';
  const max = element.max === undefined || element.max === '*' ? Infinity : Number(element.max);
  return nodesAt([value], segments).every(parent => {
    const count = occurrences(parent, name);
    return count >= (element.min ?? 0) && count <= max;
  });
}

/** One alternative must satisfy both its basic constraints and its own invariants. */
function profileConformance(
  value: Record<string, unknown>,
  profiles: Array<Pick<StructureDefinition, 'snapshot'>>,
  context: SliceProfileConformanceContext,
  unavailable = false,
): boolean | undefined {
  let unknown = unavailable;
  for (const profile of profiles) {
    if (!conformsTo(value, profile)) continue;
    const invariantState = satisfiesInvariants(value, profile, context);
    if (invariantState === true) return true;
    unknown ||= invariantState === undefined;
  }
  return unknown ? undefined : false;
}

/** An unevaluated invariant cannot prove conformance or rejection. */
function satisfiesInvariants(
  value: Record<string, unknown>,
  profile: Pick<StructureDefinition, 'snapshot'>,
  context: SliceProfileConformanceContext,
): boolean | undefined {
  const elements = profile.snapshot?.element ?? [];
  const root = elements[0]?.path ?? '';
  const rootResource = isFhirResource(context.rootResource) ? context.rootResource : undefined;
  const resource = isFhirResource(value) ? value : datatypeResourceOf(value, context);
  // Missing variables stay unbound: FHIRPath then throws and this prepass retains U.
  const environment = { ...(resource ? { resource } : {}), ...(rootResource ? { rootResource } : {}) };
  let unknown = false;
  for (const element of elements) for (const constraint of element.constraint ?? []) {
    if (constraint.severity !== 'error' || !constraint.expression || CORE_INVARIANT.test(constraint.key)) continue;
    for (const instance of valuesAt([value], segmentsBelow(root, element.path))) {
      try {
        // The type lets FHIRPath resolve primitive sidecar extensions such as CH EPR's family qualifier.
        const expression = isRecord(instance) ? { base: element.path, expression: constraint.expression } : constraint.expression;
        const { status } = classifyConstraintResult(fhirpath.evaluate(
          instance as object, expression, environment, getInvariantFhirPathModel(context.fhirVersion ?? 'R4'),
        ));
        if (status === 'failed') return false;
        unknown ||= status === 'non-boolean';
      } catch {
        unknown = true;
      }
    }
  }
  return unknown ? undefined : true;
}

/** The indexed target path proves which embedded resource owns this exact datatype. */
function datatypeResourceOf(value: Record<string, unknown>, context: SliceProfileConformanceContext) {
  if (!isFhirResource(context.rootResource)) return undefined;
  if (!context.elementPath) return context.rootResource;
  const resources = new Set(getValidationTargets(context.rootResource, context.elementPath)
    .filter(target => target.value === value)
    .map(target => focusResourceOf(context.rootResource, target.fullPath))
    .filter(isFhirResource));
  return resources.size === 1 ? [...resources][0] : undefined;
}

/** A value the profile fixes or patterns holds wherever the element occurs. */
function holdsFixedValue(value: Record<string, unknown>, element: ElementDefinition, root: string): boolean {
  const fixed = extractFixedEntry(element);
  const pattern = fixed ? undefined : extractPatternEntry(element);
  if (!fixed && !pattern) return true;
  return valuesAt([value], segmentsBelow(root, element.path)).every(instance => (fixed
    ? valueMatchesFixedConstraint(instance, fixed.value, fixed.key)
    : matchesPattern(instance, pattern!.value)));
}

function segmentsBelow(root: string, path: string): string[] {
  return path === root ? [] : path.slice(root.length + 1).split('.');
}

const CORE_INVARIANT = /^(?:ele|ext|dom|txt|ref|qty|per|rng|rat|sqty|ts|tim|dos|cpt|att|cnt|ctc|ide|inv)-\d+$/;

function valuesAt(values: unknown[], segments: string[]): unknown[] {
  if (segments.length === 0) return values;
  return nodesAt(values, segments.slice(0, -1)).flatMap(node => children(node, segments[segments.length - 1]));
}

/**
 * The elements a path passes through. A primitive's own children (`id`,
 * `extension`) sit in its `_name` sidecar: CH EPR tells BirthName from
 * HumanName by the qualifier extension in `_family`.
 */
function nodesAt(values: unknown[], segments: string[]): unknown[] {
  return segments.reduce<unknown[]>((current, segment) => current.flatMap(value => elementNodes(value, segment)), values);
}

function elementNodes(value: unknown, name: string): unknown[] {
  if (!isRecord(value)) return [];
  const keys = name.endsWith('[x]')
    ? Object.keys(value).filter(key => isConcreteChoiceProperty(key, name.slice(0, -'[x]'.length)))
    : [name];
  return keys.flatMap(key => {
    const direct = [value[key] ?? []].flat();
    const sidecars = [value[`_${key}`] ?? []].flat();
    return Array.from({ length: Math.max(direct.length, sidecars.length) }, (_, index) =>
      isRecord(direct[index]) ? direct[index] : (sidecars[index] ?? {}));
  });
}

function children(value: unknown, name: string): unknown[] {
  if (!isRecord(value)) return [];
  if (name.endsWith('[x]')) {
    const base = name.slice(0, -'[x]'.length);
    return Object.entries(value).filter(([key]) => isConcreteChoiceProperty(key, base)).flatMap(([, child]) => [child].flat());
  }
  return [value[name] ?? []].flat();
}

/** A primitive carried only by its sidecar (`_sequence`) is present. */
function occurrences(parent: unknown, name: string): number {
  if (!isRecord(parent)) return 0;
  const present = children(parent, name).length;
  if (present > 0 || name.endsWith('[x]')) return present;
  return [parent[`_${name}`] ?? []].flat().length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only this invocation's incomplete datatype preparation supplies these possible memberships. */
export function partialDatatypeMembership(value: unknown): ReadonlyMap<string, boolean | undefined> | undefined {
  return isRecord(value) && typeof value.resourceType !== 'string' ? partialProfileMembership(value) : undefined;
}

/** Incomplete local profile preparation leaves possible membership in this invocation. */
export function partialProfileMembership(value: unknown): ReadonlyMap<string, boolean | undefined> | undefined {
  return isRecord(value) ? sliceInstanceEvidence().partialProfileMembership.get(value) : undefined;
}
