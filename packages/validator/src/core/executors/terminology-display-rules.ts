import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../../terminology/terminology-issue.js';
import { normalizeDisplay } from '../../validators/valueset-display-utils.js';

// Each LOINC code maps to accepted designations, not just the current
// Long Common Name: per HL7 validator convention a resource without a language
// matches ANY designation (any language, shortnames and former names included).
// Former names cover prior LOINC releases too — e.g. the document-section
// '<X> Narrative' LCNs that LOINC 2.78 renamed to '<X> note', which official
// IG examples (hl7.fhir.eu.hdr ballot) still carry. Sets below were verified
// against tx.fhir.org LOINC $lookup/$validate-code on versions 2.82 and 2.77;
// Comparison ignores case and formatting punctuation, preserving result grades.
const KNOWN_LOINC_DISPLAYS: Record<string, string[]> = {
  '59408-5': [
    'Oxygen saturation in Arterial blood by Pulse oximetry',
    'SaO2 % BldA PulseOx',
  ],
  '3151-8': [
    'Inhaled oxygen flow rate',
    'Inhaled O2 flow rate',
    'Inhaled oxygen',
  ],
  '11369-6': [
    'History of Immunization note',
    'Hx of Immunization note',
    'History of Immunization Narrative',
    'Hx of Immunization',
  ],
  '30954-2': [
    'Relevant diagnostic tests/laboratory data note',
    'Relevant dx tests/lab data note',
    'Relevant diagnostic tests/laboratory data Narrative',
    'Relevant Dx tests/lab data',
  ],
  '8716-3': [
    'Vital signs note',
    'Vital signs',
  ],
  '29762-2': [
    'Social history note',
    'Social hx note',
    'Social history Narrative',
    'Social Hx',
  ],
  '60591-5': ['Patient summary Document', 'Patient Summary', 'Patient summary Doc'],
  '10160-0': ['History of Medication use Narrative', 'Hx of Medication use'],
  '10185-7': ['Hospital discharge procedure note', 'Hospital discharge procedures Narrative', 'Hospital dc px note'],
  '48765-2': ['Allergies and adverse reactions Document', 'Allergies &or adverse reactions Doc'],
  '11450-4': ['Problem list - Reported'],
  '47519-4': ['History of Procedures Document', 'Procedures Hx Doc'],
  '10162-6': ['History of pregnancies Narrative', 'Pregnancies Hx'],
  '51726-8': [
    'FDA product label NDC labeler code request',
    'FDA label NDC labeler code request',
  ],
  '59284-0': ['Consent Document', 'Consent', 'Patient Consent'],
};

const KNOWN_LOINC_GERMAN_DISPLAYS: Record<string, string[]> = {
  // 'Patient summary Document' is the en designation and is NOT accepted under a
  // de-* display language: $validate-code with displayLanguage=de-CH rejects it
  // and names 'Patient Summary'. Listing it here suppressed a real finding.
  '60591-5': ['Patient Summary', 'Patientenkurzakte - Dokument'],
  '10160-0': ['Medikationsanamnese - Freitext'],
  '48765-2': ['Allergien und unerwünschte Wirkungen - Dokument'],
  '11450-4': ['Problemliste - Berichtet'],
  '47519-4': ['Anamnese der Maßnahmen - Dokument'],
  '30954-2': [
    'Relevante diagnostische Tests/Laborergebnisse - Dokumentation',
    'Relevante diagnostische Tests/Labordaten - Freitext',
  ],
  '8716-3': ['Vitalparameter - Dokumentation', 'Vitalparameter'],
  '29762-2': ['Sozialanamnese - Dokumentation', 'Sozialanamnese - Freitext'],
  '10162-6': ['Anamnese früherer Schwangerschaften - Freitext'],
};

const KNOWN_EXTERNAL_DISPLAYS: Record<string, Record<string, string[]>> = {
  'http://terminology.hl7.org/CodeSystem/v2-0203': {
    PRN: ['Provider number'],
  },
  'http://hl7.org/fhir/sid/cvx': {
    '207': ['COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose or 50 mcg/0.25mL dose'],
  },
  'http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl': {
    C73330: ['UNITED STATES AGENT'],
    C43360: ['manufacture'],
    C106643: ['Manufactures human prescription drug products'],
  },
  // SNOMED CT carries hundreds of thousands of designations per concept across
  // editions and languages. Nothing enumerable in this repository can stand for
  // that set, so the entries below confirm displays they recognise and never
  // refute the ones they do not (see REFUTING_DISPLAY_SYSTEMS).
  'http://snomed.info/sct': {
    // Positive compatibility hints only: SNOMED editions have additional
    // designations that this table cannot exhaustively enumerate.
    // 'Moderate' is the plain synonym $validate-code accepts for this concept
    // (server preferred display: 'Moderate severity'). Omitting it made this
    // table reject a display the terminology server allows.
    '6736007': ['Midgrade', 'Moderate', 'Moderate (severity modifier)', 'Moderate severity'],
    '322236009': [
      'Paracetamol 500mg tablet',
      'Acetaminophen 500mg tablet',
      'Acetaminophen 500 mg oral tablet',
    ],
    '329652003': ['Ibuprofen 200mg tablet'],
  },
};

/**
 * Systems whose entries above are curated as the complete designation set for
 * the codes they list, verified against tx.fhir.org. Only those may turn an
 * unrecognised display into an error; for every other system an unrecognised
 * display means this validator could not confirm it, which is a warning and
 * not a statement that the display is wrong.
 */
const REFUTING_DISPLAY_SYSTEMS = new Set(['http://loinc.org']);

export function displayTableCanRefute(system: unknown): boolean {
  return typeof system === 'string' && REFUTING_DISPLAY_SYSTEMS.has(system);
}

export function knownDisplaysForCode(
  system: unknown,
  code: unknown,
  language?: unknown,
): string[] | undefined {
  if (typeof system !== 'string' || typeof code !== 'string') return undefined;
  return system === 'http://loinc.org'
    ? (typeof language === 'string' && language.toLocaleLowerCase().startsWith('de')
      ? KNOWN_LOINC_GERMAN_DISPLAYS[code] ?? KNOWN_LOINC_DISPLAYS[code]
      : KNOWN_LOINC_DISPLAYS[code])
    : KNOWN_EXTERNAL_DISPLAYS[system]?.[code];
}

export function isKnownCodeSystemConcept(system: unknown, code: unknown): boolean {
  if (typeof system !== 'string' || typeof code !== 'string') return false;
  return Boolean(
    knownDisplaysForCode(system, code) ||
    (system === 'http://loinc.org' && KNOWN_LOINC_GERMAN_DISPLAYS[code]),
  );
}

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

export function validateKnownLoincDisplays(resource: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceRecord = asRecord(resource);
  const root = typeof resourceRecord?.resourceType === 'string'
    ? resourceRecord.resourceType
    : 'Resource';
  const language = resourceRecord?.language;
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    if (ancestors.has(value)) return;
    ancestors.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      ancestors.delete(value);
      return;
    }

    const record = value as Record<string, unknown>;

    // Edition-specific validation belongs to the terminology resolver. In
    // particular, a short SNOMED synonym list cannot prove a display invalid.
    if (typeof record.code === 'string' && typeof record.display === 'string'
      && !record.version && record.system !== 'http://snomed.info/sct') {
      const allowedDisplays = knownDisplaysForCode(record.system, record.code, language);
      if (allowedDisplays && !anyDisplayEquivalent(allowedDisplays, record.display)) {
        const system = String(record.system);
        // Error severity matches the HL7 reference validator's default where
        // the designation set is complete (see the fhir-test-cases
        // bundle-duplicate-ids-not / bundle-with-contained Java baselines).
        // Where it is not, the table can only fail to recognise a display, and
        // saying which display is the valid one would be an invention.
        const canRefute = displayTableCanRefute(system);
        issues.push(createTerminologyIssue({
          severity: canRefute ? 'error' : 'warning',
          code: 'terminology-display-mismatch',
          message: canRefute
            ? `Wrong Display Name '${record.display}' for ${system}#${record.code}. `
              + `Valid display is '${allowedDisplays[0]}'`
            : `Display '${record.display}' for ${system}#${record.code} is not among the `
              + `designations this validator carries offline, and ${system} designations `
              + 'cannot be enumerated here. Configure a terminology server to decide it.',
          path: `${path}.display`,
          details: {
            code: record.code,
            system,
            display: record.display,
            acceptedDisplays: allowedDisplays,
            fixHint: buildDisplayMismatchFixHint(system, record.code, record.display),
          },
        }));
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) {
        continue;
      }
      visit(child, `${path}.${key}`);
    }
    ancestors.delete(value);
  };

  visit(resource, root);
  return issues;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
