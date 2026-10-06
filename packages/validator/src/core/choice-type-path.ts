import type { ElementDefinition } from './structure-definition-types.js';

interface NormalizeChoiceTypePathOptions {
  stripIndices?: boolean;
}

/**
 * Collapse concrete choice-type property names to the `[x]` form so
 * `Observation.value[x]` and `Observation.valueString` can still correlate.
 */
export function normalizeChoiceTypePath(
  path: string,
  options: NormalizeChoiceTypePathOptions = {},
): string {
  const normalizedPath = options.stripIndices === false
    ? path
    : path.replace(/\[\d+\]/g, '');

  return normalizedPath
    .split('.')
    .map(normalizeChoiceTypeSegment)
    .join('.')
    .toLowerCase();
}

const CHOICE_TYPE_BASES = [
  'value',
  'effective',
  'onset',
  'abatement',
  'occurrence',
  'timing',
  'medication',
  'component',
  'product',
  'performed',
  'deceased',
  'definition',
  'asneeded',
  'multiplebirth',
  'serviced',
  'manufactured',
  'administered',
  'allowed',
  'defaultvalue',
  'fixed',
  'pattern',
] as const;

const CHOICE_TYPE_SUFFIXES = new Set([
  'base64binary',
  'boolean',
  'canonical',
  'code',
  'date',
  'datetime',
  'decimal',
  'id',
  'instant',
  'integer',
  'markdown',
  'oid',
  'positiveint',
  'string',
  'time',
  'unsignedint',
  'uri',
  'url',
  'uuid',
  'address',
  'age',
  'annotation',
  'attachment',
  'codeableconcept',
  'coding',
  'contactpoint',
  'count',
  'distance',
  'duration',
  'humanname',
  'identifier',
  'money',
  'period',
  'quantity',
  'range',
  'ratio',
  'reference',
  'sampleddata',
  'signature',
  'timing',
  'contactdetail',
  'contributor',
  'datarequirement',
  'expression',
  'parameterdefinition',
  'relatedartifact',
  'triggerdefinition',
  'usagecontext',
]);

function normalizeChoiceTypeSegment(segment: string): string {
  const lowerSegment = segment.toLowerCase();
  if (lowerSegment.endsWith('[x]')) return lowerSegment;

  for (const base of CHOICE_TYPE_BASES) {
    if (!lowerSegment.startsWith(base) || lowerSegment.length === base.length) {
      continue;
    }

    const suffix = lowerSegment.slice(base.length);
    if (CHOICE_TYPE_SUFFIXES.has(suffix)) {
      return `${base}[x]`;
    }
  }

  return lowerSegment;
}

/** Choice property names come from the declared types, including choices unknown to the generic display normalizer. */
export function matchesDefinitionInstancePath(
  definitionPath: string,
  instancePath: string,
  elements: readonly ElementDefinition[],
): boolean {
  const expected = definitionPath.split('.');
  const actual = instancePath.replace(/\[\d+\]/g, '').split('.');
  return expected.length === actual.length && expected.every((segment, index) => {
    if (segment === actual[index]) return true;
    if (!segment.endsWith('[x]')) return false;
    const choicePath = expected.slice(0, index + 1).join('.');
    return elements.filter(element => element.path === choicePath).some(element => Array.isArray(element.type) && element.type.some(type =>
      typeof type?.code === 'string' && type.code.length > 0
      && `${segment.slice(0, -3)}${type.code[0].toUpperCase()}${type.code.slice(1)}` === actual[index]));
  });
}
