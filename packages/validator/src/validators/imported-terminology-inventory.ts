import { createHash } from 'node:crypto';
import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import { verifiedCodeSystemResult } from './code-system-validation-evidence.js';
export const mixedProjectionContract = 'records.fhirsmith.terminology-projection.v2';
export const importedSourceUrl = 'https://records-fhir.dev/StructureDefinition/imported-terminology-source';
export const ownLabelCoverageUrl = 'https://records-fhir.dev/StructureDefinition/imported-terminology-label-coverage';

type RecordValue = Record<string, unknown>;
export type FhirFamily = 'R4' | 'R5' | 'R6';
export type SourceFormat = 'loinc' | 'snomed';
export interface ActualSelectedScope {
  /** Snapshot of the existing actual loader invocation, never a requested canonical's supposed answer. */
  readonly sourceScopeKey: string;
  readonly fhirFamily: FhirFamily;
  readonly selectedCanonical: string;
  readonly selectedBusinessVersion: string;
  readonly requestedCanonical: string;
  readonly requestedBusinessVersion?: string;
  readonly defaultSelection: 'selected-by-existing-loader' | 'not-established';
}
export interface NamedInventoryDefinition {
  readonly resource: RecordValue;
  readonly format: SourceFormat;
  readonly canonical: string;
  readonly businessVersion: string;
  readonly sourceSha256: string;
  readonly conceptCount: number;
  readonly detailCodeCount: number;
  readonly detailCodesSha256: string;
}
export type InventoryDefinitionAssessment =
  | { readonly kind: 'not-mixed-import' }
  | { readonly kind: 'unverified'; readonly reason: string }
  | { readonly kind: 'named-inventory'; readonly definition: NamedInventoryDefinition };
export type NamedMembershipAssessment =
  | { readonly kind: 'unverified'; readonly reason: string }
  | { readonly kind: 'present'; readonly concept: RecordValue; readonly scope: ActualSelectedScope;
      readonly definition: NamedInventoryDefinition; readonly completeOwnDetails: boolean }
  | { readonly kind: 'absent-named-concept'; readonly scope: ActualSelectedScope;
      readonly definition: NamedInventoryDefinition };

const canonicalFor: Record<SourceFormat, string> = {
  loinc: 'http://loinc.org', snomed: 'http://snomed.info/sct',
};
const sourceFieldTypes = {
  contract: 'valueCode', displayLanguageMatch: 'valueCode', format: 'valueCode',
  sha256: 'valueString', businessVersion: 'valueString', selection: 'valueCode',
  completeNamedCodeInventory: 'valueBoolean', datasetNamedCodeCount: 'valueInteger',
  projectedNamedCodeCount: 'valueInteger', descriptionsCompleteForIncludedCodes: 'valueBoolean',
  propertiesCompleteForIncludedCodes: 'valueBoolean', relationshipsCompleteForIncludedCodes: 'valueBoolean',
  detailSelection: 'valueCode', detailCodeCount: 'valueInteger', detailCodesSha256: 'valueString',
  detailDescriptionsComplete: 'valueBoolean', detailPropertiesComplete: 'valueBoolean',
  detailRelationshipsComplete: 'valueBoolean',
} as const;
const indexes = new WeakMap<NamedInventoryDefinition, { concepts: Map<string, RecordValue>; detailCodes: Set<string> }>();
const parsedDefinitions = new WeakMap<RecordValue, InventoryDefinitionAssessment>();
const absentQueries = new WeakMap<NamedMembershipAssessment, string>();
const rejectionWitnesses = new WeakMap<CodeSystemValidationResult, {
  code: string; scope: ActualSelectedScope; definition: NamedInventoryDefinition;
}>();
const unverified = (reason: string): InventoryDefinitionAssessment => ({ kind: 'unverified', reason });

function immutableFields(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'function' || typeof value === 'symbol') return false;
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key => {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    return typeof key === 'string' && Object.hasOwn(descriptor, 'value') && immutableFields(descriptor.value, seen);
  });
}
function dataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key => typeof key === 'string'
    && (key === 'length' || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))
    && Object.hasOwn(Reflect.get(descriptors, key) as PropertyDescriptor, 'value'));
}
function record(value: unknown): RecordValue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))
    ? value as RecordValue : undefined;
}
function modified(value: RecordValue): boolean {
  return value.implicitRules !== undefined || (value.modifierExtension !== undefined
    && (!Array.isArray(value.modifierExtension) || value.modifierExtension.length > 0));
}
function knownExtensions(value: RecordValue, url: string): RecordValue[] | undefined {
  if (value.extension !== undefined && !dataArray(value.extension)) return undefined;
  const result: RecordValue[] = [];
  for (const raw of (value.extension as unknown[] | undefined) ?? []) {
    const extension = record(raw);
    if (!extension || typeof extension.url !== 'string') return undefined;
    if (extension.url === url) result.push(extension);
  }
  return result;
}
function typedFields(extension: RecordValue): RecordValue | undefined {
  if (modified(extension) || !dataArray(extension.extension)) return undefined;
  const result: RecordValue = {};
  for (const raw of extension.extension) {
    const field = record(raw);
    if (!field || typeof field.url !== 'string' || modified(field)) return undefined;
    if (!Object.hasOwn(sourceFieldTypes, field.url)) continue;
    if (Object.hasOwn(result, field.url)) return undefined;
    const key = sourceFieldTypes[field.url as keyof typeof sourceFieldTypes];
    const values = Object.keys(field).filter(name => name.startsWith('value'));
    if (values.length !== 1 || values[0] !== key) return undefined;
    const value = field[key];
    if (key === 'valueInteger' ? !Number.isSafeInteger(value)
      : key === 'valueBoolean' ? typeof value !== 'boolean' : typeof value !== 'string') return undefined;
    result[field.url] = value;
  }
  return result;
}
function completeOwnLabels(concept: RecordValue): boolean | undefined {
  const declarations = knownExtensions(concept, ownLabelCoverageUrl);
  if (!declarations || declarations.length > 1) return undefined;
  if (!declarations.length) return false;
  const declaration = declarations[0];
  if (modified(declaration) || !dataArray(declaration.extension)) return undefined;
  const entries = declaration.extension.map(record);
  if (entries.some(entry => !entry || modified(entry))) return undefined;
  const complete = entries.filter(entry => entry?.url === 'completeSourceDescriptions');
  const count = entries.filter(entry => entry?.url === 'sourceDescriptionCount');
  const scalar = (entry: RecordValue | undefined, key: string) => entry && Object.keys(entry).filter(name => name.startsWith('value')).length === 1 && Object.hasOwn(entry, key);
  if (complete.length !== 1 || !scalar(complete[0], 'valueBoolean') || complete[0]?.valueBoolean !== true || count.length !== 1 || !scalar(count[0], 'valueInteger')
    || !Number.isSafeInteger(count[0]?.valueInteger) || Number(count[0]?.valueInteger) < 0) return undefined;
  return true;
}

/** Importer/loader must additionally verify physical source/output/manifest and exact detail-list hashes. */
export function parseMixedNamedInventory(raw: unknown): InventoryDefinitionAssessment {
  const resource = record(raw);
  if (!resource) return unverified('non-data-source-resource');
  const previous = parsedDefinitions.get(resource);
  if (previous) return previous;
  const declarations = knownExtensions(resource, importedSourceUrl);
  if (!declarations) return unverified('malformed-source-extensions');
  if (!declarations.length) return { kind: 'not-mixed-import' };
  if (declarations.length !== 1) return unverified('duplicate-source-contract');
  const fields = typedFields(declarations[0]);
  if (!fields) return unverified('malformed-source-contract');
  if (fields.contract === 'records.fhirsmith.terminology-projection.v1') return { kind: 'not-mixed-import' };
  if (fields.contract !== mixedProjectionContract) return unverified('unsupported-source-contract');
  if (resource.resourceType !== 'CodeSystem' || modified(resource) || resource.supplements !== undefined
    || resource.content !== 'fragment' || resource.caseSensitive !== true
    || !Object.keys(sourceFieldTypes).every(key => Object.hasOwn(fields, key)))
    return unverified('incomplete-mixed-contract');
  const format = fields.format;
  if (format !== 'loinc' && format !== 'snomed') return unverified('unsupported-source-format');
  if (resource.url !== canonicalFor[format] || typeof resource.version !== 'string' || !resource.version
    || fields.businessVersion !== resource.version || fields.displayLanguageMatch !== 'base-language'
    || typeof fields.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fields.sha256)
    || (format === 'loinc' && resource.language !== 'en-US')) return unverified('contradictory-source-identity');
  if (format === 'snomed' && !/^http:\/\/snomed\.info\/sct\/\d+\/version\/\d{8}$/.test(resource.version))
    return unverified('malformed-own-edition');
  if (fields.selection !== 'all-named-codes' || fields.completeNamedCodeInventory !== true
    || fields.descriptionsCompleteForIncludedCodes !== false || fields.propertiesCompleteForIncludedCodes !== false
    || fields.relationshipsCompleteForIncludedCodes !== false || fields.detailSelection !== 'code-list'
    || fields.detailDescriptionsComplete !== true || typeof fields.detailPropertiesComplete !== 'boolean'
    || typeof fields.detailRelationshipsComplete !== 'boolean'
    || fields.detailPropertiesComplete !== (format === 'loinc') || fields.detailRelationshipsComplete !== (format === 'loinc')
    || typeof fields.detailCodesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fields.detailCodesSha256))
    return unverified('contradictory-coverage');
  if (!dataArray(resource.concept) || !resource.concept.length || resource.count !== resource.concept.length
    || fields.datasetNamedCodeCount !== resource.concept.length || fields.projectedNamedCodeCount !== resource.concept.length
    || !Number.isSafeInteger(fields.detailCodeCount) || Number(fields.detailCodeCount) < 1
    || Number(fields.detailCodeCount) > resource.concept.length) return unverified('contradictory-named-counts');
  const concepts = new Map<string, RecordValue>();
  let reusable = Object.isFrozen(resource) && Object.isFrozen(resource.concept)
    && immutableFields(resource.extension) && immutableFields(resource.modifierExtension);
  const detailCodes = new Set<string>();
  for (const rawConcept of resource.concept) {
    const concept = record(rawConcept);
    if (!concept || modified(concept) || typeof concept.code !== 'string' || !concept.code
      || concept.code !== concept.code.trim() || !/^[\x21-\x7e]+$/.test(concept.code)
      || concept.concept !== undefined || concepts.has(concept.code)) return unverified('ambiguous-named-inventory');
    const labels = completeOwnLabels(concept);
    if (labels === undefined) return unverified('malformed-detail-coverage');
    if (labels) detailCodes.add(concept.code);
    reusable &&= immutableFields(concept);
    concepts.set(concept.code, concept);
  }
  if (detailCodes.size !== fields.detailCodeCount) return unverified('contradictory-detail-count');
  const detailHash = createHash('sha256').update(JSON.stringify([...detailCodes].sort())).digest('hex');
  if (detailHash !== fields.detailCodesSha256) return unverified('contradictory-detail-hash');
  const definition: NamedInventoryDefinition = Object.freeze({
    resource, format, canonical: resource.url as string, businessVersion: resource.version,
    sourceSha256: fields.sha256, conceptCount: concepts.size, detailCodeCount: detailCodes.size,
    detailCodesSha256: fields.detailCodesSha256,
  });
  indexes.set(definition, { concepts, detailCodes });
  const result = Object.freeze({ kind: 'named-inventory' as const, definition });
  if (reusable) parsedDefinitions.set(resource, result);
  return result;
}

/** Answers named-inventory membership only; never CodeSystem expression validity or display validity. */
export function assessSelectedNamedMembership(definition: NamedInventoryDefinition,
  scope: ActualSelectedScope, code: string): NamedMembershipAssessment {
  if (!record(scope)) return { kind: 'unverified', reason: 'non-data-selected-scope' };
  const selectedScope = Object.freeze({ ...scope });
  if (typeof selectedScope.sourceScopeKey !== 'string' || !selectedScope.sourceScopeKey
    || !['R4', 'R5', 'R6'].includes(selectedScope.fhirFamily)
    || selectedScope.selectedCanonical !== definition.canonical || selectedScope.requestedCanonical !== definition.canonical
    || selectedScope.selectedBusinessVersion !== definition.businessVersion
    || (selectedScope.requestedBusinessVersion !== undefined && selectedScope.requestedBusinessVersion !== definition.businessVersion)
    || (!selectedScope.requestedBusinessVersion && selectedScope.defaultSelection !== 'selected-by-existing-loader'))
    return { kind: 'unverified', reason: 'scope-or-edition-not-established' };
  if (!code || code !== code.trim()) return { kind: 'unverified', reason: 'not-an-exact-code-query' };
  const index = indexes.get(definition);
  if (!index) return { kind: 'unverified', reason: 'definition-was-not-parsed-by-this-owner' };
  const concept = index.concepts.get(code);
  if (concept) return Object.freeze({ kind: 'present', concept, scope: selectedScope, definition,
    completeOwnDetails: index.detailCodes.has(code) });
  const absent = Object.freeze({ kind: 'absent-named-concept' as const, scope: selectedScope, definition });
  absentQueries.set(absent, code);
  return absent;
}

/** These sources enumerate named concepts; SNOMED expression semantics remain independent. */
export function canAssertNamedCodeRejection(assessment: NamedMembershipAssessment, code: string): boolean {
  if (assessment.kind !== 'absent-named-concept' || absentQueries.get(assessment) !== code) return false;
  if (assessment.definition.format === 'loinc') return !/^LA\d+-\d$/.test(code);
  return /^[1-9]\d{5,17}$/.test(code)
    && assessment.scope.requestedBusinessVersion === assessment.definition.businessVersion;
}

export function importedNamedCodeRejection(assessment: NamedMembershipAssessment,
  code: string): CodeSystemValidationResult | undefined {
  if (assessment.kind !== 'absent-named-concept' || !canAssertNamedCodeRejection(assessment, code)) return undefined;
  const result = verifiedCodeSystemResult({ valid: false, reason: 'code-unknown' as const,
    incompleteCodeSystem: false,
    message: "Unknown named code '" + code + "' in CodeSystem '" + assessment.definition.canonical
      + "' version '" + assessment.definition.businessVersion + "'" });
  rejectionWitnesses.set(result, { code, scope: assessment.scope, definition: assessment.definition });
  return result;
}

export function isImportedNamedCodeRejection(result: CodeSystemValidationResult, code: string,
  system: string, fhirFamily?: FhirFamily, requestedVersion?: string): boolean {
  const witness = rejectionWitnesses.get(result);
  return Boolean(witness && witness.code === code && witness.definition.canonical === system
    && witness.scope.requestedBusinessVersion === requestedVersion
    && (!fhirFamily || witness.scope.fhirFamily === fhirFamily));
}

export function importedInventorySourceFormat(codeSystem: CodeSystem): SourceFormat | undefined {
  const assessment = parseMixedNamedInventory(codeSystem);
  return assessment.kind === 'named-inventory' ? assessment.definition.format : undefined;
}

export function selectedInventoryConcept(assessment: NamedMembershipAssessment): CodeSystemConcept | undefined {
  return assessment.kind === 'present' ? assessment.concept as unknown as CodeSystemConcept : undefined;
}


/** Presence within this exact imported definition, without issuing an absence or hierarchy verdict. */
export function findImportedInventoryConcept(codeSystem: CodeSystem, code: string): CodeSystemConcept | null | undefined {
  const parsed = parseMixedNamedInventory(codeSystem);
  if (parsed.kind === 'not-mixed-import') return undefined;
  if (parsed.kind === 'unverified') return null;
  return (indexes.get(parsed.definition)?.concepts.get(code) as unknown as CodeSystemConcept | undefined) ?? null;
}
