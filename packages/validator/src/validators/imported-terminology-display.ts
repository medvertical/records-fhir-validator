import { importedInventorySourceFormat } from './imported-terminology-inventory.js';
import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';
import { parseLanguageTag } from './language-code-validator.js';
import { hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';

const prefix = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const sourceUrl = `${prefix}source`;
const coverageUrl = `${prefix}label-coverage`;
const descriptionUrl = `${prefix}description`;
type Fields = Record<string, unknown>;
interface Label { value: string; language: string; active: boolean; }
interface Assessment {
  outcome: 'accepted' | 'mismatch' | 'unverified';
  displays: string[];
  inactiveMatch?: boolean;
}
const valueTypes: Record<string, string> = {
  contract: 'valueCode', format: 'valueCode', displayLanguageMatch: 'valueCode',
  sha256: 'valueString', businessVersion: 'valueString', id: 'valueString', value: 'valueString',
  completeSourceDescriptions: 'valueBoolean', sourceDescriptionCount: 'valueInteger',
  language: 'valueCode', kind: 'valueCode', active: 'valueBoolean', acceptedLabel: 'valueBoolean',
};
const unverified = (): Assessment => ({ outcome: 'unverified', displays: [] });
const record = (value: unknown): Fields | undefined => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Fields : undefined;

function extensions(value: unknown, url: string): Fields[] {
  const list = record(value)?.extension;
  return Array.isArray(list) ? list.flatMap(raw => {
    const entry = record(raw);
    return entry?.url === url ? [entry] : [];
  }) : [];
}

function fields(extension: Fields): Fields | undefined {
  if (!Array.isArray(extension.extension) || hasUnknownTerminologyModifiers(extension)) return undefined;
  const result: Fields = {};
  for (const raw of extension.extension) {
    const entry = record(raw);
    if (!entry || typeof entry.url !== 'string' || hasUnknownTerminologyModifiers(entry)) return undefined;
    if (!Object.hasOwn(valueTypes, entry.url)) continue;
    if (Object.hasOwn(result, entry.url)) return undefined;
    const values = Object.keys(entry).filter(key => key.startsWith('value'));
    if (values.length !== 1 || (valueTypes[entry.url] && values[0] !== valueTypes[entry.url])) return undefined;
    result[entry.url] = entry[values[0]];
  }
  return result;
}

function baseLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const canonical = value.split('-').map((part, index) => index === 0 ? part.toLowerCase()
    : /^[a-z]{2}$/i.test(part) ? part.toUpperCase()
    : /^[a-z]{4}$/i.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase()).join('-');
  return parseLanguageTag(canonical) === null ? canonical.split('-')[0] : undefined;
}

function sourceFormat(codeSystem: CodeSystem, source: Fields): 'loinc' | 'snomed' | undefined {
  const contract = fields(source);
  if (contract?.contract === 'records.fhirsmith.terminology-projection.v2')
    return importedInventorySourceFormat(codeSystem);
  if (!contract || contract.contract !== 'records.fhirsmith.terminology-projection.v1'
    || contract.displayLanguageMatch !== 'base-language' || contract.businessVersion !== codeSystem.version
    || typeof contract.businessVersion !== 'string' || !contract.businessVersion
    || typeof contract.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(contract.sha256)) return undefined;
  if (contract.format === 'loinc' && codeSystem.url === 'http://loinc.org' && codeSystem.language === 'en-US') return 'loinc';
  if (contract.format === 'snomed' && codeSystem.url === 'http://snomed.info/sct') return 'snomed';
  return undefined;
}

function sourceLabels(concept: CodeSystemConcept, format: 'loinc' | 'snomed'): Label[] | undefined {
  if (concept.designation !== undefined && !Array.isArray(concept.designation)) return undefined;
  const coverage = extensions(concept, coverageUrl);
  const declaration = coverage.length === 1 ? fields(coverage[0]) : undefined;
  if (!declaration || declaration.completeSourceDescriptions !== true
    || !Number.isSafeInteger(declaration.sourceDescriptionCount) || Number(declaration.sourceDescriptionCount) < 0) return undefined;
  const labels: Label[] = [];
  const ids = new Set<string>();
  const descriptions: Array<{ metadata: Fields; designation?: Fields }> =
    extensions(concept, descriptionUrl).map(metadata => ({ metadata }));
  for (const designation of concept.designation ?? []) {
    if (hasUnknownTerminologyModifiers(designation)) return undefined;
    const own = extensions(designation, descriptionUrl);
    if (own.length !== 1) return undefined;
    descriptions.push({ metadata: own[0], designation: designation as Fields });
  }
  if (descriptions.length !== declaration.sourceDescriptionCount) return undefined;
  for (const { metadata, designation } of descriptions) {
    const description = fields(metadata);
    if (!description || typeof description.id !== 'string' || !description.id || ids.has(description.id)
      || typeof description.value !== 'string' || !description.value.trim()
      || !baseLanguage(description.language) || typeof description.kind !== 'string') return undefined;
    ids.add(description.id);
    const active = format === 'snomed' ? description.active : description.acceptedLabel;
    if (typeof active !== 'boolean') return undefined;
    if (designation && (designation.value !== description.value || designation.language !== description.language || !active)) return undefined;
    if (!designation && active) return undefined;
    // Related LOINC search names are retained facts, not accepted display labels.
    if (format === 'loinc' && !active) continue;
    labels.push({ value: description.value, language: String(description.language), active });
  }
  if (format === 'loinc' && typeof concept.display === 'string' && concept.display.trim())
    labels.unshift({ value: concept.display, language: 'en-US', active: true });
  return labels;
}

/** A provider's language/status contract is used only with its complete own concept descriptions. */
export function assessImportedTerminologyDisplay(codeSystem: CodeSystem, concept: CodeSystemConcept,
  display: string, displayLanguage?: string): Assessment | null {
  const sourceExtensions = record(codeSystem)?.extension;
  if (sourceExtensions !== undefined && !Array.isArray(sourceExtensions)) return unverified();
  const declarations = extensions(codeSystem, sourceUrl);
  if (declarations.length === 0) return null;
  if (declarations.length !== 1) return unverified();
  const format = sourceFormat(codeSystem, declarations[0]);
  const labels = format && sourceLabels(concept, format);
  if (!labels) return unverified();
  const language = displayLanguage ? baseLanguage(displayLanguage) : undefined;
  if (displayLanguage && !language) return unverified();
  const selected = labels.filter(label => !language || baseLanguage(label.language) === language);
  const displays = [...new Set(selected.filter(label => label.active).map(label => label.value))];
  const matches = (label: Label) => label.value.toLocaleLowerCase() === display.toLocaleLowerCase();
  if (selected.some(label => label.active && matches(label))) return { outcome: 'accepted', displays };
  if (displays.length > 0 && selected.some(label => !label.active && matches(label)))
    return { outcome: 'mismatch', displays, inactiveMatch: true };
  return displays.length > 0 ? { outcome: 'mismatch', displays } : unverified();
}
