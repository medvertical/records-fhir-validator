export type BindingStrength = 'required' | 'extensible' | 'preferred' | 'example';

export interface CodeInfo {
  code: string;
  system?: string;
  version?: string;
  display?: string;
  codingIndex?: number;
}

export function resourceTypeFromElementPath(elementPath: string): string {
  const firstSegment = elementPath.split('.')[0]?.replace(/\[[^\]]+\]/g, '');
  return firstSegment || 'Unknown';
}

export function buildDisplayMismatchFixHint(
  codeInfo: CodeInfo,
  expectedDisplay: string,
): string {
  return `Replace display '${codeInfo.display}' with '${expectedDisplay}' for ` +
    `${codeInfo.system}#${codeInfo.code}, or omit display and let the terminology consumer render it.`;
}

export function displaysEquivalent(expected: string, actual: string): boolean {
  return normalizeDisplay(expected) === normalizeDisplay(actual);
}

/**
 * LOINC and SNOMED CT carry more designations than this validator can
 * enumerate; a terminology server confirms their displays, so formatting
 * variants of a known designation are tolerated.
 */
const DESIGNATION_TOLERANT_SYSTEMS = new Set(['http://loinc.org', 'http://snomed.info/sct']);

/**
 * Every other code system is matched like the reference validator does: the
 * display must equal the concept's display or a designation, ignoring case
 * only — `Next of Kin` is not `Next-of-Kin`.
 */
export function displaysEquivalentForCodeInfo(
  expected: string,
  actual: string,
  codeInfo: Pick<CodeInfo, 'system' | 'code'>,
): boolean {
  if (!DESIGNATION_TOLERANT_SYSTEMS.has(codeInfo.system ?? '')) {
    return expected.toLocaleLowerCase() === actual.toLocaleLowerCase();
  }
  if (displaysEquivalent(expected, actual)) return true;
  if (displayOperators(expected) !== displayOperators(actual)) return false;

  if (codeInfo.system === 'http://loinc.org') {
    return loincDisplaysCompatible(expected, actual);
  }

  if (codeInfo.system === 'http://snomed.info/sct'
    && displaysEquivalent(
      expected.replace(/\s+\(specimen\)\s*$/i, ''),
      actual.replace(/\s+\(specimen\)\s*$/i, ''),
    )) return true;

  if (
    codeInfo.system === 'http://snomed.info/sct'
    && codeInfo.code === '6736007'
  ) {
    return moderateSeverityDisplaysEquivalent(expected, actual);
  }

  return false;
}

function moderateSeverityDisplaysEquivalent(expected: string, actual: string): boolean {
  const accepted = new Set([
    'midgrade',
    'moderate',
    'moderate severity',
    'moderate severity modifier',
  ]);
  return accepted.has(normalizeDisplay(expected)) && accepted.has(normalizeDisplay(actual));
}

export function normalizeDisplay(display: string): string {
  return stripTrailingSemanticTag(display)
    .trim()
    .normalize('NFKC')
    .replace(/>=/g, '≥')
    .replace(/<=/g, '≤')
    .replace(/(^|[=\s])-(?=\s*$|\d)/g, '$1−')
    .replace(/['’]s\b/gi, '')
    // Grades and numeric comparisons change a concept's meaning.
    .replace(/([+<>±−≥≤])/g, ' $1 ')
    .replace(/[^\p{L}\p{N}+<>±−≥≤]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function displayOperators(display: string): string {
  return normalizeDisplay(display).match(/[+<>±−≥≤]/g)?.join('') ?? '';
}

function stripTrailingSemanticTag(display: string): string {
  const semanticTag = String.raw`(?:finding|disorder|procedure|regime/therapy|observable entity|situation|body structure)`;
  return display
    .replace(new RegExp(String.raw`\s+\(${semanticTag}\)\s*$`, 'i'), '')
    .replace(new RegExp(String.raw`\s+\(${semanticTag}\s*$`, 'i'), '');
}

const LOINC_STOPWORDS = new Set([
  'a', 'and', 'arbitrary', 'area', 'automated', 'based', 'by',
  'calculated', 'count', 'direct', 'entity', 'entitic', 'estimated', 'formula',
  'in', 'mass', 'mean', 'moles', 'mole', 'numeric', 'patient', 'plasma',
  'predicted', 'quantitative', 'rate', 'ratio', 'serum', 'sq', 'system',
  'temporal', 'the', 'total', 'volume', 'with',
]);

function loincDisplaysCompatible(expected: string, actual: string): boolean {
  const expectedTokens = meaningfulLoincTokens(expected);
  const actualTokens = meaningfulLoincTokens(actual);
  if (actualTokens.length === 0 || expectedTokens.length === 0) return false;

  const expectedSet = new Set(expectedTokens);
  const actualSet = new Set(actualTokens);
  const actualContainedInExpected = actualTokens.every(token => expectedSet.has(token));
  const expectedContainedInActual = expectedTokens.every(token => actualSet.has(token));

  if (!actualContainedInExpected && !expectedContainedInActual) return false;

  // Avoid accepting overly vague one-word displays for more specific LOINC
  // concepts, while still allowing true one-analyte common names like
  // "Glucose" or "Calcium".
  return actualSet.size >= 2 || expectedSet.size <= 2;
}

function meaningfulLoincTokens(display: string): string[] {
  return normalizeDisplay(display)
    .replace(/\bhigh density lipoprotein\b/g, 'hdl')
    .replace(/\blow density lipoprotein\b/g, 'ldl')
    .replace(/\bcomplete blood count\b/g, 'cbc')
    .replace(/\bglomerular filtration\b/g, 'glomerular filtration')
    .replace(/\bnhis\b/g, '')
    .split(' ')
    .map(token => canonicalLoincToken(token))
    .filter(token => token.length > 1 && !LOINC_STOPWORDS.has(token));
}

function canonicalLoincToken(token: string): string {
  if (token === 'hemogram') return 'cbc';
  if (token === 'hospitalizations') return 'hospitalization';
  if (token === 'visits') return 'visit';
  if (token === 'triglycerides') return 'triglyceride';
  return token;
}
