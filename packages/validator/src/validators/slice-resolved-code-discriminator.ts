import type { SliceDefinition, ResolvedCodeDiscriminatorEvidence, ReferenceResolver } from './slice-types.js';
import { snapshotTargetProfileSource } from '../core/snapshot-type-profile-authority.js';
import type { ElementDefinition, StructureDefinition, SlicingDiscriminator } from '../core/structure-definition-types.js';
import type { TypeProfileResolverFn } from './slice-info-inheritance.js';
import type { ProfileReferenceSource } from '../core/profile-reference-authority.js';
import { getNonEmptyString, getProfileElements } from './slice-info-input.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import { getTypeSpecsForDiscriminator } from './slice-type-discriminator.js';
import {
  extractFixedFromElement,
  extractPatternFromElement,
  getValueAtPath,
  valuesMatch,
} from './slice-utils.js';

export type ResolvedCodeDefinitionResolver = (url: string, source: ProfileReferenceSource) => Promise<StructureDefinition | null>;

/** Target resource assertions must never become Reference child constraints. */
export async function loadResolvedCodeDiscriminatorEvidence(
  slice: SliceDefinition,
  resolver: TypeProfileResolverFn,
  element?: ElementDefinition,
  profileDefinition?: StructureDefinition,
  resolveOwnedDefinition?: ResolvedCodeDefinitionResolver,
): Promise<void> {
  const evidence = new Map<string, ResolvedCodeDiscriminatorEvidence>();
  for (const discriminator of slice.discriminator ?? []) {
    if (discriminator.type !== 'value' && discriminator.type !== 'pattern') continue;
    const step = splitResolveDiscriminatorPath(discriminator.path);
    if (!step || !isSupportedCodePath(step.remainder) || evidence.has(evidenceKey(step.referencePath, step.remainder))) continue;
    const profiles = getTypeSpecsForDiscriminator(slice, step.referencePath)
      .flatMap(type => type.targetProfile ?? []);
    const entry: ResolvedCodeDiscriminatorEvidence = {
      fixedValues: [], patterns: [], complete: profiles.length > 0 && (resolver !== null || resolveOwnedDefinition !== undefined),
    };
    for (const profile of profiles) {
      if (!resolver && !resolveOwnedDefinition) break;
      try {
        const declaration = element && (step.referencePath === '$this' ? element
          : profileDefinition?.snapshot?.element.find(child => child.id === `${element.id}.${step.referencePath}`));
        const issuedType = declaration?.type?.find(type => type.targetProfile?.includes(profile));
        const source = issuedType && profileDefinition
          ? snapshotTargetProfileSource(issuedType, profileDefinition) : profileDefinition;
        const definition = resolveOwnedDefinition && source
          ? await resolveOwnedDefinition(profile, source) : await resolver?.(profile);
        const [canonical, requestedVersion] = profile.split('|');
        if (!definition || definition.url !== canonical
          || (requestedVersion !== undefined && definition.version !== requestedVersion)) {
          entry.complete = false;
          continue;
        }
        const root = getNonEmptyString(definition.type);
        if (step.remainder === 'code.coding') {
          const patterns = root && requiredCodingPatterns(definition, root);
          if (patterns) entry.patterns.push(patterns);
          else entry.complete = false;
          continue;
        }
        const code = definition && root
          ? getProfileElements(definition).find(element => element.path === `${root}.code`)
          : undefined;
        const fixed = code && extractFixedFromElement(code);
        const pattern = code && extractPatternFromElement(code);
        if (fixed !== undefined) entry.fixedValues.push(fixed);
        else if (pattern !== undefined) entry.patterns.push(pattern);
        else entry.complete = false;
      } catch {
        entry.complete = false;
      }
    }
    evidence.set(evidenceKey(step.referencePath, step.remainder), entry);
  }
  if (evidence.size > 0) slice.resolvedCodeDiscriminators = evidence;
}

export function resolvedCodeDiscriminatorHasEvidence(
  slice: SliceDefinition,
  path: string,
): boolean | undefined {
  const step = splitResolveDiscriminatorPath(path);
  if (!step || !isSupportedCodePath(step.remainder)) return undefined;
  const evidence = slice.resolvedCodeDiscriminators?.get(evidenceKey(step.referencePath, step.remainder));
  return evidence?.complete === true
    && (evidence.fixedValues.length > 0 || evidence.patterns.length > 0);
}

export function matchResolvedCodeDiscriminator(
  resolved: unknown,
  slice: SliceDefinition,
  referencePath: string,
  discriminatorType: string,
  matchesPattern: (value: unknown, pattern: unknown) => boolean,
  codePath = 'code',
): boolean {
  const evidence = slice.resolvedCodeDiscriminators?.get(evidenceKey(referencePath, codePath));
  if (!evidence?.complete) return false;
  const code = getValueAtPath(resolved, codePath);
  return evidence.patterns.some(pattern => matchesPattern(code, pattern))
    || evidence.fixedValues.some(fixed => discriminatorType === 'pattern'
      ? matchesPattern(code, fixed)
      : valuesMatch(code, fixed));
}

/**
 * Missing target evidence cannot erase an independently known violation of
 * every allowed slice's required literal Reference child. This is a profile
 * rejection; logical and display-only References remain valid base shapes.
 */
export function requiredReferencePrecludesSlice(element: unknown, slice: SliceDefinition): boolean {
  return (slice.discriminator ?? []).some(discriminator => {
      if (discriminator.type !== 'value' && discriminator.type !== 'pattern') return false;
      const step = splitResolveDiscriminatorPath(discriminator.path);
      if (!step || !isSupportedCodePath(step.remainder)) return false;
      const childPath = step.referencePath === '$this'
        ? 'reference' : `${step.referencePath}.reference`;
      if ((slice.childMin?.get(childPath) ?? 0) < 1) return false;
      return hasKnownMissingLiteralChild(getValueAtPath(element, step.referencePath));
    });
}

export type ResolvedCodeMatchEvidence = 'matched' | 'nonmember' | 'unknown';

export function usesResolvedCodeDiscrimination(discriminators: SlicingDiscriminator[]): boolean {
  return discriminators.some(discriminator => (discriminator.type === 'value' || discriminator.type === 'pattern')
    && isSupportedCodePath(splitResolveDiscriminatorPath(discriminator.path)?.remainder));
}

/** Missing metadata or a target cannot prove nonmembership. A read target's missing code can. */
export function assessResolvedCodeDiscriminator(
  element: unknown,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
  resolver: ReferenceResolver | null,
  matchesPattern: (value: unknown, pattern: unknown) => boolean,
): ResolvedCodeMatchEvidence | null {
  const step = splitResolveDiscriminatorPath(discriminator.path);
  if ((discriminator.type !== 'value' && discriminator.type !== 'pattern') || !step || !isSupportedCodePath(step.remainder)) return null;
  if (!resolvedCodeDiscriminatorHasEvidence(slice, discriminator.path)) return 'unknown';
  const candidates = referenceCandidates(element, step.referencePath);
  let unknown = candidates.length === 0;
  for (const candidate of candidates) {
    const target = readTarget(candidate, resolver);
    if (target === null) unknown = true;
    else if (matchResolvedCodeDiscriminator(target, slice, step.referencePath, discriminator.type, matchesPattern, step.remainder)) return 'matched';
  }
  return unknown ? 'unknown' : 'nonmember';
}

export function resolvedCodeTargetIsUnavailable(
  element: unknown,
  discriminator: SlicingDiscriminator,
  resolver: ReferenceResolver | null,
): boolean {
  const step = splitResolveDiscriminatorPath(discriminator.path);
  if ((discriminator.type !== 'value' && discriminator.type !== 'pattern') || !step || !isSupportedCodePath(step.remainder)) return false;
  const candidates = referenceCandidates(element, step.referencePath);
  return candidates.length === 0 || candidates.some(candidate => readTarget(candidate, resolver) === null);
}

function referenceCandidates(element: unknown, referencePath: string): unknown[] {
  const value = referencePath === '$this' ? element : getValueAtPath(element, referencePath);
  return Array.isArray(value) ? value : [value];
}

function readTarget(referenceValue: unknown, resolver: ReferenceResolver | null): unknown | null {
  const reference = typeof referenceValue === 'string' ? referenceValue
    : typeof referenceValue === 'object' && referenceValue !== null && !Array.isArray(referenceValue)
      ? (referenceValue as Record<string, unknown>).reference : undefined;
  if (typeof reference !== 'string' || !reference || !resolver) return null;
  try { return resolver(reference) ?? null; } catch { return null; }
}

function hasKnownMissingLiteralChild(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  // A primitive sidecar can supply an element without its literal value.
  // Neither that shape nor accessor/inherited fields proves child absence.
  if ('reference' in value || '_reference' in value) return false;
  return true;
}

function isSupportedCodePath(path: string | undefined): boolean {
  return path === 'code' || path === 'code.coding';
}

function evidenceKey(referencePath: string, codePath: string): string {
  return codePath === 'code' ? referencePath : `${referencePath}.${codePath}`;
}

/** Only required own snapshot assertions can identify a target's Coding collection. */
function requiredCodingPatterns(definition: StructureDefinition, root: string): unknown[] | null {
  const elements = definition.snapshot?.element;
  if (!elements?.length) return null;
  const path = `${root}.code.coding`;
  const bases = elements.filter(element => element.path === path && !element.sliceName);
  if (bases.length !== 1) return null;
  const base = bases[0];
  const rootCodes = elements.filter(element => element.path === `${root}.code` && !element.sliceName);
  if (rootCodes.length !== 1 || (rootCodes[0].min ?? 0) < 1) return null;
  const rootCode = rootCodes[0];
  if (!base.id || elements.filter(element => element.id === base.id).length !== 1
    || (rootCode.id && elements.filter(element => element.id === rootCode.id).length !== 1)) return null;
  const rootPattern = rootCode && (extractPatternFromElement(rootCode) ?? extractFixedFromElement(rootCode));
  const projected = rootPattern && getValueAtPath(rootPattern, 'coding');
  if (Array.isArray(projected) && projected.length) return projected;
  const direct = extractPatternFromElement(base) ?? extractFixedFromElement(base);
  if (direct !== undefined && (base.min ?? 0) >= 1) return [direct];
  const required = elements.filter(element => element.path === path && element.sliceName
    && element.id === `${base.id}:${element.sliceName}` && (element.min ?? 0) >= 1);
  if (!required.length || required.some(element => elements.filter(candidate => candidate.id === element.id).length !== 1)) return null;
  const patterns = required.map(element => extractPatternFromElement(element) ?? extractFixedFromElement(element));
  return patterns.every(pattern => pattern !== undefined) ? patterns : null;
}
