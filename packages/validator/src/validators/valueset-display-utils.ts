import type { ValidationIssue } from '../types';

export type BindingStrength = 'required' | 'extensible' | 'preferred' | 'example';

export interface CodeInfo {
  code: string;
  system?: string;
  display?: string;
  codingIndex?: number;
}

export function displayMismatchSeverityForBinding(
  bindingStrength?: BindingStrength,
): ValidationIssue['severity'] {
  if (bindingStrength === 'required') return 'error';
  if (bindingStrength === 'preferred') return 'information';
  return 'warning';
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

export function displaysEquivalentForCodeInfo(
  expected: string,
  actual: string,
  codeInfo: Pick<CodeInfo, 'system'>,
): boolean {
  if (displaysEquivalent(expected, actual)) return true;

  if (codeInfo.system === 'http://terminology.hl7.org/CodeSystem/v2-0203') {
    return stripIdentifierNumberSuffix(normalizeDisplay(expected)) === normalizeDisplay(actual);
  }

  return false;
}

function normalizeDisplay(display: string): string {
  return stripTrailingSemanticTag(display)
    .trim()
    .normalize('NFKC')
    .replace(/['’]s\b/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function stripTrailingSemanticTag(display: string): string {
  const semanticTag = String.raw`(?:finding|disorder|procedure|regime/therapy|observable entity|situation|body structure)`;
  return display
    .replace(new RegExp(String.raw`\s+\(${semanticTag}\)\s*$`, 'i'), '')
    .replace(new RegExp(String.raw`\s+\(${semanticTag}\s*$`, 'i'), '');
}

function stripIdentifierNumberSuffix(display: string): string {
  return display.replace(/\s+number$/i, '');
}
