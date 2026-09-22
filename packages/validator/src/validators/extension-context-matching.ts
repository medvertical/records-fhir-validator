import type { StructureDefinition } from '../core/structure-definition-types.js';
import { isRecord } from '../core/fhir-resource.js';

/**
 * Where an extension instance is attached, relative to the nearest enclosing
 * resource (contained resources and Bundle-entry resources start a new root).
 */
export interface ExtensionUsageSite {
  resourceType: string;
  /** Index-free element path from the resource root, e.g. `Patient.name`. */
  elementPath: string;
  attachment: 'resource-root' | 'element' | 'nested-extension';
  parentExtensionUrl?: string;
}

export interface NormalizedExtensionContext {
  type: 'element' | 'fhirpath' | 'extension' | 'unknown';
  expression: string;
}

export type ExtensionContextVerdict = 'allowed' | 'violation' | 'indeterminate';

type EntryVerdict = 'match' | 'no-match' | 'unknown';

/**
 * Reads the declared usage contexts from an extension StructureDefinition.
 * Supports the R4/R5 shape (`context[].type` + `expression`) and the legacy
 * DSTU3 shape (`contextType` + `context: string[]`) still found in converted
 * packages. Returns null when the definition declares no contexts.
 */
export function extractExtensionContexts(
  sd: StructureDefinition,
): NormalizedExtensionContext[] | null {
  const rawContext = sd.context;
  if (!Array.isArray(rawContext) || rawContext.length === 0) return null;

  if (rawContext.every(entry => typeof entry === 'string')) {
    const legacyType = sd.contextType === 'extension' ? 'extension'
      : sd.contextType === 'resource' || sd.contextType === 'datatype' ? 'element'
        : 'unknown';
    return rawContext.map(expression => ({ type: legacyType, expression: expression as string }));
  }

  return rawContext.map((entry): NormalizedExtensionContext => {
    if (!isRecord(entry) || typeof entry.expression !== 'string') {
      return { type: 'unknown', expression: '' };
    }
    const entryType = entry.type === 'element' || entry.type === 'fhirpath' || entry.type === 'extension'
      ? entry.type
      : 'unknown';
    return { type: entryType, expression: entry.expression };
  });
}

/**
 * Contexts are OR'd, so a violation requires proving that no entry can match.
 * Any entry this cheap matcher cannot evaluate makes the whole check
 * indeterminate instead of guessing.
 */
export function checkExtensionContextUsage(
  contexts: NormalizedExtensionContext[],
  site: ExtensionUsageSite,
): ExtensionContextVerdict {
  let sawUnknown = false;
  for (const context of contexts) {
    const verdict = matchContextEntry(context, site);
    if (verdict === 'match') return 'allowed';
    if (verdict === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'indeterminate' : 'violation';
}

function matchContextEntry(
  context: NormalizedExtensionContext,
  site: ExtensionUsageSite,
): EntryVerdict {
  switch (context.type) {
    case 'element':
      return matchElementExpression(context.expression, site);
    case 'extension':
      return site.parentExtensionUrl === context.expression ? 'match' : 'no-match';
    case 'fhirpath':
      return matchFhirPathExpression(context.expression, site);
    default:
      return 'unknown';
  }
}

/** Resource roots that are not DomainResources in any supported FHIR version. */
const NON_DOMAIN_RESOURCES = new Set(['Bundle', 'Parameters', 'Binary']);

/**
 * R5 abstract canonical bases; matching them needs the resource inheritance
 * tree, so usages under them stay unevaluated rather than mis-classified.
 */
const ABSTRACT_RESOURCE_BASES = new Set(['CanonicalResource', 'MetadataResource']);

const SIMPLE_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*(\[x\])?)*$/;

function matchElementExpression(expression: string, site: ExtensionUsageSite): EntryVerdict {
  // Canonical URLs / logical-model targets are out of scope for this matcher.
  if (expression.includes(':')) return 'unknown';
  if (expression === 'Element' || expression === 'Any' || expression === '*') return 'match';

  if (site.attachment === 'nested-extension') {
    return expression === 'Extension' ? 'match' : 'unknown';
  }

  const isRoot = site.attachment === 'resource-root';
  if (expression === 'Resource') return isRoot ? 'match' : 'no-match';
  if (expression === 'DomainResource') {
    return isRoot && !NON_DOMAIN_RESOURCES.has(site.resourceType) ? 'match' : 'no-match';
  }
  if (!SIMPLE_PATH_PATTERN.test(expression)) return 'unknown';

  if (!expression.includes('.')) {
    if (!isRoot) {
      // Could name the element's datatype (e.g. HumanName at Patient.name);
      // v1 has no element-type resolution, so stay indeterminate.
      return 'unknown';
    }
    if (ABSTRACT_RESOURCE_BASES.has(expression)) return 'unknown';
    return expression === site.resourceType ? 'match' : 'no-match';
  }

  // Dotted expressions name a nested element, which a resource root never is.
  if (isRoot) return 'no-match';

  const [expressionRoot] = expression.split('.');
  // Datatype-rooted type paths (e.g. Timing.repeat) need element-type
  // resolution to compare against a resource-rooted site path.
  if (expressionRoot !== site.resourceType) return 'unknown';

  // Below the root, literal path equality can prove a match, but a mismatch
  // cannot prove a violation: contentReference re-entries rewrite the
  // definition path (Questionnaire.item.item.answerOption is defined at
  // Questionnaire.item.answerOption), which this matcher does not model.
  return comparePathSegments(expression, site.elementPath) === 'match' ? 'match' : 'unknown';
}

function comparePathSegments(expression: string, elementPath: string): EntryVerdict {
  const expressionSegments = expression.split('.');
  const siteSegments = elementPath.split('.');
  if (expressionSegments.length !== siteSegments.length) return 'no-match';

  let sawChoiceAmbiguity = false;
  for (let i = 0; i < expressionSegments.length; i++) {
    const expected = expressionSegments[i];
    const actual = siteSegments[i];
    if (expected === actual) continue;
    if (expected.endsWith('[x]')) {
      const stem = expected.slice(0, -3);
      if (actual.startsWith(stem) && /^[A-Z]/.test(actual.slice(stem.length))) continue;
      return 'no-match';
    }
    // `Observation.value` vs `Observation.valueQuantity`: the expression may
    // target the choice element without a [x] marker — do not claim a
    // violation on that ambiguity.
    if (actual.startsWith(expected) && /^[A-Z]/.test(actual.slice(expected.length))) {
      sawChoiceAmbiguity = true;
      continue;
    }
    return 'no-match';
  }
  return sawChoiceAmbiguity ? 'unknown' : 'match';
}

/**
 * FHIRPath contexts are only evaluated when they are unions of plain element
 * paths. Anything with functions or filters (`where(...)`, `ofType(...)`,
 * `extension(...)`) stays indeterminate by design.
 */
function matchFhirPathExpression(expression: string, site: ExtensionUsageSite): EntryVerdict {
  let sawUnknown = false;
  for (const part of expression.split('|')) {
    const candidate = part.trim();
    if (!SIMPLE_PATH_PATTERN.test(candidate)) {
      sawUnknown = true;
      continue;
    }
    const verdict = matchElementExpression(candidate, site);
    if (verdict === 'match') return 'match';
    if (verdict === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'no-match';
}
