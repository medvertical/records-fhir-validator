import type { ValidationIssue } from '../../types';

const KNOWN_LOINC_DISPLAYS: Record<string, string[]> = {
  '59408-5': [
    'Oxygen saturation in Arterial blood by Pulse oximetry',
    'SaO2 % BldA PulseOx',
  ],
  '3151-8': [
    'Inhaled oxygen flow rate',
    'Inhaled O2 flow rate',
  ],
  '11369-6': [
    'History of Immunization note',
    'Hx of Immunization note',
  ],
  '30954-2': [
    'Relevant diagnostic tests/laboratory data note',
    'Relevant dx tests/lab data note',
  ],
  '8716-3': [
    'Vital signs note',
  ],
  '29762-2': [
    'Social history note',
    'Social hx note',
  ],
};

export function buildDisplayMismatchFixHint(
  system: string,
  code: string,
  display: string | undefined,
): string {
  const current = display ? ` '${display}'` : '';
  return `Replace display${current} with an accepted display for ${system}#${code}, or omit display and let the terminology consumer render it.`;
}

export function displaysEquivalent(expected: string | undefined, actual: string | undefined): boolean {
  if (!expected || !actual) return false;
  return normalizeDisplay(expected) === normalizeDisplay(actual);
}

export function anyDisplayEquivalent(expected: string[], actual: string | undefined): boolean {
  if (!actual) return false;
  return expected.some(display => displaysEquivalent(display, actual));
}

export function extractExpectedDisplay(message: string | undefined): string | undefined {
  return extractAcceptedDisplays(message)[0];
}

export function extractAcceptedDisplays(message: string | undefined): string[] {
  if (!message) return [];

  const single = message.match(/Valid display is '(.+?)'(?:\s+\([^)]+\))?(?:\s+\(for the language\(s\)|$)/);
  if (single?.[1]) return [single[1]];

  const oneOf = message.match(/Valid display is one of \d+ choices:\s*(.+?)(?:\s*\(for the language\(s\)|$)/);
  if (!oneOf?.[1]) return [];

  return [...oneOf[1].matchAll(/'(.+?)'\s+\([^)]+\)(?:\s+or\s+|$)/g)]
    .map(match => match[1])
    .filter((display): display is string => Boolean(display));
}

export function uniqueAcceptedDisplays(displays: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const display of displays) {
    const key = normalizeDisplay(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(display);
  }

  return result;
}

export function validateKnownLoincDisplays(resource: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const root = resource?.resourceType || 'Resource';

  const visit = (value: any, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!value || typeof value !== 'object') return;

    if (
      value.system === 'http://loinc.org' &&
      typeof value.code === 'string' &&
      typeof value.display === 'string'
    ) {
      const allowedDisplays = KNOWN_LOINC_DISPLAYS[value.code];
      if (allowedDisplays && !allowedDisplays.includes(value.display)) {
        issues.push({
          id: `terminology-loinc-display-mismatch-${Date.now()}-${issues.length}`,
          aspect: 'terminology',
          severity: 'warning',
          code: 'terminology-display-mismatch',
          message:
            `Wrong Display Name '${value.display}' for http://loinc.org#${value.code}. ` +
            `Valid display is '${allowedDisplays[0]}'`,
          path: `${path}.display`,
          timestamp: new Date(),
          details: {
            code: value.code,
            system: 'http://loinc.org',
            display: value.display,
            acceptedDisplays: allowedDisplays,
            fixHint: buildDisplayMismatchFixHint('http://loinc.org', value.code, value.display),
          },
        });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) {
        continue;
      }
      visit(child, `${path}.${key}`);
    }
  };

  visit(resource, root);
  return issues;
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
