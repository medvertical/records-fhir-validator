import type { ProfileReferenceSource } from '../core/profile-reference-pins.js';
import type { ElementDefinition } from '../core/structure-definition-types.js';
import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { copyNumberSources } from '../input/number-source.js';

export type ProfileConformanceVerdict = boolean | undefined | 'not-applicable';

/** Undefined means unavailable evidence; not-applicable identifies a different resource type. */
export type ProfileConformanceCheck = (
  resource: Record<string, unknown>,
  profileUrl: string,
  referencingProfile?: ProfileReferenceSource,
) => Promise<ProfileConformanceVerdict>;

export type ProfileConformanceLookup = (resource: object, profileUrl: string) => boolean | undefined;

const CONFORMS_TO = /conformsTo\(\s*'([^']+)'\s*\)/g;
const MAX_NESTING = 4;
export class ProfileConformanceUnavailableError extends Error {
  constructor() { super('The requested datatype profile conformance could not be established');this.name = 'ProfileConformanceUnavailableError'; }
}

/**
 * FHIRPath evaluates invariants synchronously, so the profiles they ask
 * conformsTo() about are checked beforehand: for the validated resource and
 * the resources it holds (Bundle entries, contained, Parameters). A resource
 * no check could decide keeps the declared-profile reading.
 */
export async function precomputeProfileConformance(
  elements: ElementDefinition[],
  resource: unknown,
  check: ProfileConformanceCheck,
  options: { strictUnknown?: boolean } = {},
): Promise<ProfileConformanceLookup | undefined> {
  const urls = new Set<string>();
  for (const element of elements) {
    for (const constraint of element.constraint ?? []) {
      for (const match of (constraint.expression ?? '').matchAll(CONFORMS_TO)) urls.add(match[1]);
    }
  }
  if (urls.size === 0) return undefined;

  const verdicts = new WeakMap<object, Map<string, boolean | undefined>>();
  const datatypes = new WeakSet<object>();
  for (const held of heldResources(resource)) {
    for (const url of urls) {
      const conforms = await check(held, url);
      if (conforms !== undefined || options.strictUnknown) verdicts.set(held,
        (verdicts.get(held) ?? new Map()).set(url, conforms === undefined ? undefined : conforms === true));
    }
  }
  if (isRecord(resource)) for (const element of elements) {
    const references = new Set((element.constraint ?? []).flatMap(rule =>
      [...(rule.expression ?? '').matchAll(CONFORMS_TO)].map(match => match[1])));
    if (!references.size) continue;
    const types = [...new Set((element.type ?? []).map(type => type.code))];
    if (types.length !== 1 || !types[0]) continue;
    for (const target of getValidationTargets(resource, element.path)) {
      const value = target.value;
      if (!isRecord(value) || typeof value.resourceType === 'string') continue;
      datatypes.add(value);
      const typed = copyNumberSources(value, { ...value, resourceType: types[0] });
      for (const url of references) {
        const conforms = await check(typed, url);
        verdicts.set(value, (verdicts.get(value) ?? new Map()).set(url,
          conforms === undefined ? undefined : conforms === true));
      }
    }
  }
  return (node, url) => {
    const known = verdicts.get(node);
    if ((options.strictUnknown || datatypes.has(node)) && known?.has(url) && known.get(url) === undefined) throw new ProfileConformanceUnavailableError();
    return known?.get(url);
  };
}

function heldResources(resource: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const visit = (value: unknown, depth: number): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth);
      return;
    }
    if (!isRecord(value) || depth > MAX_NESTING) return;
    if (typeof value.resourceType === 'string') found.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'text' && typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(resource, 0);
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
