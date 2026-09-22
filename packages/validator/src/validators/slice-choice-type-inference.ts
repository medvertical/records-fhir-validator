import type { SliceDefinition } from './slice-types.js';

export function inferChoiceSliceType(sliceDef: SliceDefinition, elementPath: string): void {
  if (sliceDef.type && sliceDef.type.length > 0) return;

  const choiceBase = elementPath.split('.').pop()?.replace('[x]', '');
  if (!choiceBase || !elementPath.endsWith('[x]') || !sliceDef.sliceName.startsWith(choiceBase)) {
    return;
  }

  const suffix = sliceDef.sliceName.slice(choiceBase.length);
  const code = choiceSliceSuffixToTypeCode(suffix);
  if (code) sliceDef.type = [{ code }];
}

const PRIMITIVE_CHOICE_TYPE_SUFFIXES = new Map<string, string>([
  ['Base64Binary', 'base64Binary'],
  ['Boolean', 'boolean'],
  ['Canonical', 'canonical'],
  ['Code', 'code'],
  ['Date', 'date'],
  ['DateTime', 'dateTime'],
  ['Decimal', 'decimal'],
  ['Id', 'id'],
  ['Instant', 'instant'],
  ['Integer', 'integer'],
  ['Integer64', 'integer64'],
  ['Markdown', 'markdown'],
  ['Oid', 'oid'],
  ['PositiveInt', 'positiveInt'],
  ['String', 'string'],
  ['Time', 'time'],
  ['UnsignedInt', 'unsignedInt'],
  ['Uri', 'uri'],
  ['Url', 'url'],
  ['Uuid', 'uuid'],
  ['Xhtml', 'xhtml'],
]);

function choiceSliceSuffixToTypeCode(suffix: string): string | null {
  if (!suffix) return null;
  return PRIMITIVE_CHOICE_TYPE_SUFFIXES.get(suffix) ?? suffix;
}
