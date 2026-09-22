import type { SlicingDiscriminator } from '../core/structure-definition-types.js';
import type { SliceDefinition } from './slice-types.js';
import { getValueAtPath, matchesPattern } from './slice-utils.js';

type DiscriminatorMatcher = (
  element: unknown,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
) => boolean;

export function isRelaxedCodingIdentityCardinalityMatch(
  element: unknown,
  slice: SliceDefinition,
  discriminators: SlicingDiscriminator[],
  matchDiscriminator: DiscriminatorMatcher,
): boolean {
  for (const discriminator of discriminators) {
    if (!matchDiscriminator(element, slice, discriminator)) {
      return false;
    }

    if (isCodingIdentityRelaxedPatternMatch(element, slice, discriminator)) {
      return true;
    }
  }

  return false;
}

function isCodingIdentityRelaxedPatternMatch(
  element: unknown,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
): boolean {
  if (discriminator.type !== 'pattern') return false;
  if (discriminator.path && discriminator.path !== '$this') return false;
  if (slice.patternKind !== 'patternCoding' || slice.pattern === undefined) return false;

  const elementValue = getValueAtPath(element, discriminator.path);
  if (matchesPattern(elementValue, slice.pattern)) return false;

  return codingIdentityMatchesPattern(elementValue, slice.pattern);
}

function codingIdentityMatchesPattern(elementValue: unknown, patternValue: unknown): boolean {
  if (!isRecord(elementValue) || !isRecord(patternValue)) return false;
  if (typeof patternValue.system !== 'string' || typeof patternValue.code !== 'string') {
    return false;
  }
  return elementValue.system === patternValue.system && elementValue.code === patternValue.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
