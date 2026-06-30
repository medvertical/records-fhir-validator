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
