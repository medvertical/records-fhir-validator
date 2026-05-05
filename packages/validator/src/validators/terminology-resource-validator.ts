/* eslint-disable max-lines -- covers spec rules for both CodeSystem and ValueSet resources */
/**
 * Terminology Resource Validator
 *
 * Validates CodeSystem and ValueSet resources for terminology-specific
 * business rules that the Java reference validator checks:
 *
 * CodeSystem:
 * - caseSensitive SHOULD be stated (warning for HL7-defined CodeSystems)
 * - Concepts SHOULD have a definition (warning for HL7-defined CodeSystems)
 * - Complete CodeSystem with no concepts (warning)
 * - Canonical URL must be absolute
 * - Concept property valueCoding codes must exist in the referenced CodeSystem
 *   (when that CodeSystem is available in the local cache)
 *
 * ValueSet:
 * - Canonical URL must be absolute
 * - compose.include.system must be absolute (not fragment reference)
 * - Contained CodeSystem canonical URL must be absolute
 * - compose.include.filter[].op must be one of the FHIR-defined operators
 * - compose.include.filter[].property must exist on the referenced CodeSystem
 *   (when that CodeSystem is available in the local cache)
 * - For `=` filters on Coding-typed properties, value must be in
 *   `system(|version)#code` format and the code must exist in the referenced
 *   sub-CodeSystem
 * - For `regex` filters, value must compile as a valid JS RegExp
 *
 * UUID validation:
 * - urn:uuid: values must contain valid, lowercase UUIDs
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { valueSetCache } from './valueset-cache';
import type { CodeSystem, CodeSystemConcept } from './valueset-types';

// ============================================================================
// Constants
// ============================================================================

/** HL7-defined CodeSystem URL patterns — these get stricter business rules */
const HL7_URL_PATTERNS = [
  /^http:\/\/hl7\.org\/fhir\//,
  /^http:\/\/terminology\.hl7\.org\//,
  /^https?:\/\/.*\.hl7\.org\//,
];

/**
 * HL7-defined CodeSystem concept-property URIs. A property with a URI in
 * this namespace must use one of these suffixes; otherwise Java emits a
 * `business-rule` error to discourage squatting on the HL7 prefix
 * (see R4.cs-order-prop-r4-base / R5.cs-order-prop-r5-base baselines).
 *
 * Union of R4 (https://hl7.org/fhir/r4/codesystem-concept-properties.html)
 * and R5 (https://hl7.org/fhir/codesystem-concept-properties.html). New
 * spec releases that add codes should append here. Intentionally excludes
 * `order` — neither R4 nor R5 list it under this namespace.
 */
const HL7_CONCEPT_PROPERTY_NAMESPACE = 'http://hl7.org/fhir/concept-properties#';
const HL7_KNOWN_CONCEPT_PROPERTIES = new Set<string>([
  'status',
  'inactive',
  'effectiveDate',
  'deprecationDate',
  'deprecated',
  'notSelectable',
  'parent',
  'child',
  'partOf',
  'synonym',
  'comment',
  'comments',
  'itemWeight',
]);

/** Valid UUID pattern: 8-4-4-4-12 hex digits, lowercase */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * ValueSet filter operators allowed by the FilterOperator ValueSet
 * (http://hl7.org/fhir/ValueSet/filter-operator). Anything outside this
 * set is an invalid compose.include.filter[].op value.
 */
const ALLOWED_FILTER_OPS = new Set([
  '=',
  'is-a',
  'descendent-of',
  'is-not-a',
  'regex',
  'in',
  'not-in',
  'generalizes',
  'exists',
]);

/**
 * Parse a `system(|version)#code` filter value. Returns null when the
 * value is not in that format, otherwise returns the parsed parts. The
 * `|version` section is optional.
 */
function parseSystemVersionCode(
  value: string,
): { system: string; version?: string; code: string } | null {
  const hashIdx = value.lastIndexOf('#');
  if (hashIdx <= 0) return null;
  const left = value.slice(0, hashIdx);
  const code = value.slice(hashIdx + 1);
  if (!code) return null;
  if (!/^https?:\/\//.test(left) && !/^urn:/.test(left)) return null;
  const pipeIdx = left.indexOf('|');
  if (pipeIdx >= 0) {
    return { system: left.slice(0, pipeIdx), version: left.slice(pipeIdx + 1), code };
  }
  return { system: left, code };
}

/**
 * Look up a code in a CodeSystem's concept tree (walks nested concepts).
 */
function codeSystemHasCode(cs: CodeSystem | undefined, code: string): boolean {
  if (!cs || !Array.isArray(cs.concept)) return false;
  const stack: CodeSystemConcept[] = [...cs.concept];
  while (stack.length > 0) {
    const c = stack.pop()!;
    if (c?.code === code) return true;
    if (Array.isArray(c?.concept)) stack.push(...c.concept);
  }
  return false;
}

/**
 * Look up the canonical display for a code in a CodeSystem (walks nested
 * concepts). Returns undefined when the code is missing or the concept
 * has no display value.
 */
function codeSystemDisplayFor(cs: CodeSystem | undefined, code: string): string | undefined {
  if (!cs || !Array.isArray(cs.concept)) return undefined;
  const stack: CodeSystemConcept[] = [...cs.concept];
  while (stack.length > 0) {
    const c = stack.pop()!;
    if (c?.code === code) return typeof c.display === 'string' ? c.display : undefined;
    if (Array.isArray(c?.concept)) stack.push(...c.concept);
  }
  return undefined;
}

function countCodeSystemConcepts(concepts: CodeSystemConcept[] | undefined): number {
  if (!Array.isArray(concepts)) return 0;
  let count = 0;
  const stack: CodeSystemConcept[] = [...concepts];
  while (stack.length > 0) {
    const concept = stack.pop()!;
    count++;
    if (Array.isArray(concept?.concept)) stack.push(...concept.concept);
  }
  return count;
}

/**
 * Fetch a CodeSystem from the local cache. Both `setCodeSystem` and
 * `setCodeSystemFile` are populated by the conformance runner and the
 * package loader, so we check both.
 */
function getCachedCodeSystem(systemUrl: string | undefined): CodeSystem | undefined {
  if (!systemUrl) return undefined;
  return (
    valueSetCache.getCodeSystem(systemUrl) ??
    valueSetCache.getCodeSystemFile(systemUrl) ??
    undefined
  );
}

// ============================================================================
// Helpers
// ============================================================================

/** Drop the `|version` suffix from a canonical URL, leaving the base. */
function stripVersion(url: string): string {
  const idx = url.indexOf('|');
  return idx >= 0 ? url.slice(0, idx) : url;
}

/**
 * CodeSystems large enough that the reference Java validator validates
 * codes only via the terminology server. ConceptMap source-code checks
 * are skipped against these and we emit an informational hint instead
 * (matches `R5.cs-val-cm-base`).
 */
const TX_ONLY_CODE_SYSTEMS = new Set<string>([
  'http://loinc.org',
  'http://snomed.info/sct',
  'http://www.nlm.nih.gov/research/umls/rxnorm',
  'http://hl7.org/fhir/sid/icd-10',
  'http://hl7.org/fhir/sid/icd-10-cm',
  'http://hl7.org/fhir/sid/icd-9-cm',
  'http://hl7.org/fhir/sid/icd-11',
  'http://hl7.org/fhir/sid/cvx',
  'http://www.ama-assn.org/go/cpt',
  'http://unitsofmeasure.org',
  'http://www.whocc.no/atc',
]);

function isTxOnlySystem(url: string): boolean {
  return TX_ONLY_CODE_SYSTEMS.has(stripVersion(url));
}

function isHl7Url(url: string): boolean {
  return HL7_URL_PATTERNS.some(p => p.test(url));
}

function isAbsoluteUri(uri: string): boolean {
  return /^https?:\/\//.test(uri) || /^urn:/.test(uri);
}

/**
 * Validate a urn:uuid: value. The UUID portion after the prefix must be
 * a valid RFC 4122 UUID (8-4-4-4-12 hex digits) and lowercase.
 */
function validateUrnUuid(urn: string): { valid: boolean; uuid: string } {
  const uuid = urn.replace(/^urn:uuid:/, '');
  return { valid: UUID_REGEX.test(uuid), uuid };
}

// ============================================================================
// Validator
// ============================================================================

export class TerminologyResourceValidator {
  /**
   * Validate terminology-specific business rules on a resource.
   * Returns empty array for non-CodeSystem/ValueSet resources.
   */
  validate(resource: any): ValidationIssue[] {
    if (!resource || typeof resource !== 'object') return [];

    switch (resource.resourceType) {
      case 'CodeSystem':
        return this.validateCodeSystem(resource);
      case 'ValueSet':
        return this.validateValueSet(resource);
      case 'ConceptMap':
        return this.validateConceptMap(resource);
      default:
        return [];
    }
  }

  // ==========================================================================
  // CodeSystem
  // ==========================================================================

  // eslint-disable-next-line max-lines-per-function -- CodeSystem validation has many spec rules
  private validateCodeSystem(cs: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const url = typeof cs.url === 'string' ? cs.url : '';
    const hl7 = isHl7Url(url);

    // NOTE: Top-level URL absoluteness is already checked by the
    // structural executor's uri-format-validator, so we skip it here
    // to avoid duplicate errors in the OperationOutcome.

    // --- urn:uuid: must be valid ---
    if (url.startsWith('urn:uuid:')) {
      const { valid, uuid } = validateUrnUuid(url);
      if (!valid) {
        issues.push(createValidationIssue({
          code: 'tx-codesystem-url-invalid-uuid',
          path: 'CodeSystem.url',
          resourceType: 'CodeSystem',
          customMessage: `UUIDs must be valid and lowercase (${uuid})`,
          severityOverride: 'error',
        }));
      }
    }

    // --- caseSensitive SHOULD be stated ---
    // Skip when content is 'not-present' or 'fragment' — those CodeSystems
    // don't define codes locally, so caseSensitive is not meaningful.
    const contentDefinesCodes = cs.content === 'complete' || cs.content === 'example' || cs.content === 'supplement';
    if (contentDefinesCodes && (cs.caseSensitive === undefined || cs.caseSensitive === null)) {
      const severity = hl7 ? 'warning' : 'information';
      const prefix = hl7 ? 'HL7 Defined ' : '';
      issues.push(createValidationIssue({
        code: 'tx-codesystem-missing-casesensitive',
        path: 'CodeSystem',
        resourceType: 'CodeSystem',
        customMessage:
          `${prefix}CodeSystems SHOULD have a stated value for the caseSensitive element ` +
          `so that users know the status and meaning of the code system clearly`,
        severityOverride: severity,
      }));
    }

    // --- Supplement must have content = 'supplement' ---
    if (cs.supplements && cs.content !== 'supplement') {
      issues.push(createValidationIssue({
        code: 'tx-codesystem-supplement-content',
        path: 'CodeSystem.content',
        resourceType: 'CodeSystem',
        customMessage:
          `CodeSystem Supplements SHALL have a content value of 'supplement'`,
        severityOverride: 'error',
      }));
    }

    // --- Complete CodeSystem with no concepts ---
    if (cs.content === 'complete') {
      const concepts = cs.concept;
      const hasConcepts = Array.isArray(concepts) && concepts.length > 0;
      if (!hasConcepts) {
        issues.push(createValidationIssue({
          code: 'tx-codesystem-complete-no-concepts',
          path: 'CodeSystem',
          resourceType: 'CodeSystem',
          customMessage:
            `When a CodeSystem has content = 'complete', it doesnt make sense for there to be no concepts defined`,
          severityOverride: 'warning',
        }));
      }

      if (typeof cs.count === 'number' && hasConcepts) {
        const actualCount = countCodeSystemConcepts(concepts);
        if (cs.count !== actualCount) {
          issues.push(createValidationIssue({
            code: 'tx-codesystem-count-mismatch',
            path: 'CodeSystem.count',
            resourceType: 'CodeSystem',
            customMessage:
              `The code system is complete, but the number of concepts (${actualCount}) ` +
              `does not match the stated total number (${cs.count})`,
            severityOverride: 'error',
          }));
        }
      }
    }

    // --- HL7 concepts SHOULD have a definition ---
    if (hl7 && Array.isArray(cs.concept)) {
      for (let i = 0; i < cs.concept.length; i++) {
        const concept = cs.concept[i];
        if (concept && !concept.definition) {
          issues.push(createValidationIssue({
            code: 'tx-codesystem-concept-no-definition',
            path: `CodeSystem.concept[${i}]`,
            resourceType: 'CodeSystem',
            customMessage:
              `HL7 Defined CodeSystems should ensure that every concept has a definition`,
            severityOverride: 'warning',
          }));
          // One warning is sufficient — Java reports on first concept only
          break;
        }
      }
    }

    // --- Property should have a URI ---
    // Java warns when a CodeSystem.property has only a `code` and no `uri`,
    // because without a URI the property has no interoperable meaning.
    if (Array.isArray(cs.property)) {
      for (let i = 0; i < cs.property.length; i++) {
        const prop = cs.property[i];
        if (prop?.code && !prop.uri) {
          issues.push(createValidationIssue({
            code: 'tx-codesystem-property-no-uri',
            path: `CodeSystem.property[${i}]`,
            resourceType: 'CodeSystem',
            customMessage:
              `This property has only a code ('${prop.code}') and not a URI, ` +
              `so it has no clearly defined meaning in the terminology ecosystem`,
            severityOverride: 'information',
          }));
        }
        // --- HL7-namespace URIs must be in the spec list ---
        if (typeof prop?.uri === 'string' && prop.uri.startsWith(HL7_CONCEPT_PROPERTY_NAMESPACE)) {
          const suffix = prop.uri.slice(HL7_CONCEPT_PROPERTY_NAMESPACE.length);
          if (!HL7_KNOWN_CONCEPT_PROPERTIES.has(suffix)) {
            issues.push(createValidationIssue({
              code: 'business-rule-cs-unknown-hl7-property',
              path: `CodeSystem.property[${i}]`,
              resourceType: 'CodeSystem',
              customMessage:
                `Unknown CodeSystem Property '${prop.uri}'. ` +
                `If you are creating your own property, do not create it in the HL7 namespace`,
              severityOverride: 'error',
            }));
          }
        }
      }
    }

    // --- Concept property valueCoding codes must exist in the referenced system ---
    // Java emits `code-invalid` at
    // `CodeSystem.concept[i].property[j].value.ofType(Coding).code` when the
    // Coding references a system we know and the code is not defined there.
    // We only check this when the target CodeSystem is in the local cache,
    // so this stays a no-op for codes from systems the runtime has never seen.
    if (Array.isArray(cs.concept)) {
      for (let i = 0; i < cs.concept.length; i++) {
        issues.push(...this.validateConceptPropertyValueCodes(cs.concept[i], i, 'CodeSystem'));
      }
    }

    return issues;
  }

  /**
   * Walk a single concept's property array, emitting errors when a
   * `valueCoding` references an unknown code in an in-cache CodeSystem.
   * Walks nested `concept[]` recursively so sub-concepts are checked too.
   */
  private validateConceptPropertyValueCodes(
    concept: any,
    index: number,
    pathPrefix: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!concept || typeof concept !== 'object') return issues;

    const conceptPath = `${pathPrefix}.concept[${index}]`;

    if (Array.isArray(concept.property)) {
      for (let p = 0; p < concept.property.length; p++) {
        const prop = concept.property[p];
        const coding = prop?.valueCoding;
        if (!coding || typeof coding !== 'object') continue;
        const system = typeof coding.system === 'string' ? coding.system : undefined;
        const code = typeof coding.code === 'string' ? coding.code : undefined;
        if (!system || !code) continue;

        const targetCs = getCachedCodeSystem(system);
        if (!targetCs) continue;

        if (!codeSystemHasCode(targetCs, code)) {
          const version = typeof targetCs.version === 'string' ? targetCs.version : 'null';
          issues.push(createValidationIssue({
            code: 'tx-codesystem-concept-property-code-invalid',
            path: `${conceptPath}.property[${p}].value.ofType(Coding).code`,
            resourceType: 'CodeSystem',
            customMessage:
              `Unknown code '${code}' in the CodeSystem '${system}' version '${version}'`,
            severityOverride: 'error',
          }));
        }
      }
    }

    if (Array.isArray(concept.concept)) {
      for (let j = 0; j < concept.concept.length; j++) {
        issues.push(...this.validateConceptPropertyValueCodes(
          concept.concept[j],
          j,
          conceptPath,
        ));
      }
    }

    return issues;
  }

  // ==========================================================================
  // ValueSet
  // ==========================================================================

  private validateValueSet(vs: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const url = typeof vs.url === 'string' ? vs.url : '';

    // NOTE: Top-level URL absoluteness is already checked by the
    // structural executor's uri-format-validator, so we skip it here
    // to avoid duplicate errors in the OperationOutcome.

    // --- urn:uuid: must be valid ---
    if (url.startsWith('urn:uuid:')) {
      const { valid, uuid } = validateUrnUuid(url);
      if (!valid) {
        issues.push(createValidationIssue({
          code: 'tx-valueset-url-invalid-uuid',
          path: 'ValueSet.url',
          resourceType: 'ValueSet',
          customMessage: `UUIDs must be valid and lowercase (${uuid})`,
          severityOverride: 'error',
        }));
      }
    }

    // --- Contained CodeSystem checks ---
    if (Array.isArray(vs.contained)) {
      for (let i = 0; i < vs.contained.length; i++) {
        const contained = vs.contained[i];
        if (contained?.resourceType === 'CodeSystem') {
          issues.push(...this.validateContainedCodeSystem(contained, i));
        }
      }
    }

    // --- compose.include.system must be absolute + filter checks ---
    if (vs.compose?.include && Array.isArray(vs.compose.include)) {
      for (let i = 0; i < vs.compose.include.length; i++) {
        const include = vs.compose.include[i];
        const system = include?.system;
        if (typeof system === 'string' && system.startsWith('#')) {
          issues.push(createValidationIssue({
            code: 'tx-valueset-compose-system-fragment',
            path: `ValueSet.compose.include[${i}]`,
            resourceType: 'ValueSet',
            customMessage:
              `URI values in ValueSet.compose.include.system must be absolute. ` +
              `To reference a contained code system, use the full CodeSystem URL ` +
              `and reference it using the http://hl7.org/fhir/StructureDefinition/valueset-system extension`,
            severityOverride: 'error',
          }));
        }

        issues.push(...this.validateComposeFilters(
          include,
          `ValueSet.compose.include[${i}]`,
        ));
      }
    }

    // --- compose.exclude[] filters get the same treatment ---
    if (vs.compose?.exclude && Array.isArray(vs.compose.exclude)) {
      for (let i = 0; i < vs.compose.exclude.length; i++) {
        issues.push(...this.validateComposeFilters(
          vs.compose.exclude[i],
          `ValueSet.compose.exclude[${i}]`,
        ));
      }
    }

    // --- ValueSet.expansion best-practice checks ---
    if (vs.expansion && typeof vs.expansion === 'object') {
      issues.push(...this.validateValueSetExpansion(vs.expansion));
    }

    return issues;
  }

  /**
   * Apply the three best-practice rules Java raises against
   * `ValueSet.expansion` (see R4.vs-expansion-base baseline):
   *   1. Missing/empty `expansion.parameter` — without parameters the
   *      consumer can't tell whether the expansion is safe to reuse.
   *   2. Missing `expansion.identifier` — informational nudge for
   *      audit/traceability.
   *   3. Each `expansion.contains[i].system` that is unversioned must be
   *      listed via a `used-codesystem` expansion parameter; otherwise
   *      consumers can't pin the source CodeSystem version.
   */
  private validateValueSetExpansion(expansion: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const params: any[] = Array.isArray(expansion?.parameter) ? expansion.parameter : [];

    if (params.length === 0) {
      issues.push(createValidationIssue({
        code: 'tx-valueset-expansion-no-parameters',
        path: 'ValueSet.expansion',
        resourceType: 'ValueSet',
        customMessage:
          `This expansion has no parameters; in the absence of the parameters that ` +
          `controlled the expansion, systems may not be able to determine whether ` +
          `it is safe to use this expansion`,
        severityOverride: 'warning',
      }));
    }

    if (typeof expansion?.identifier !== 'string' || expansion.identifier.length === 0) {
      issues.push(createValidationIssue({
        code: 'tx-valueset-expansion-no-identifier',
        path: 'ValueSet.expansion',
        resourceType: 'ValueSet',
        customMessage:
          `This expansion has no identifier. Identifiers are recommended to help ` +
          `with audit and traceability`,
        severityOverride: 'information',
      }));
    }

    // Collect declared `used-codesystem` systems so we only warn about
    // ones not pinned by the expansion parameters.
    const declaredUsedCodesystems = new Set<string>();
    for (const p of params) {
      if (p?.name === 'used-codesystem' && typeof p.valueUri === 'string') {
        declaredUsedCodesystems.add(stripVersion(p.valueUri));
      }
    }

    if (Array.isArray(expansion.contains)) {
      const seen = new Set<string>();
      for (let i = 0; i < expansion.contains.length; i++) {
        const c = expansion.contains[i];
        const system: string | undefined = typeof c?.system === 'string' ? c.system : undefined;
        if (!system) continue;
        // Skip when the system already pins a version (system|version) or
        // when the contains entry itself carries a version field.
        if (system.includes('|') || (typeof c.version === 'string' && c.version.length > 0)) continue;
        if (declaredUsedCodesystems.has(system)) continue;
        if (seen.has(system)) continue;
        seen.add(system);
        issues.push(createValidationIssue({
          code: 'tx-valueset-expansion-system-no-version',
          path: 'ValueSet.expansion',
          resourceType: 'ValueSet',
          customMessage:
            `Because the expansion uses system '${system}' without a version, ` +
            `it should list the system using the expansion parameter 'used-codesystem'`,
          severityOverride: 'warning',
        }));
      }
    }

    return issues;
  }

  // ==========================================================================
  // ConceptMap
  // ==========================================================================

  /**
   * Validate ConceptMap target displays against the target CodeSystem,
   * matching the diagnostics Java emits in `R5.cs-val-cm-base`:
   *
   *   1. info `business-rule` "Source Code System X is only supported on
   *      the terminology server, so the source codes are not validated for
   *      performance reasons" — emitted when the source system is one of
   *      the well-known tx-only namespaces (LOINC, SNOMED, RxNorm, …).
   *   2. warning `required` "The target display 'Y' for the code 'S#C' is
   *      not valid. Possible displays: 'Z'" — when the target display does
   *      not match (case-insensitive) the canonical display in the target
   *      CodeSystem. Skipped when the target CodeSystem is not in cache.
   */
  private validateConceptMap(cm: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const groups: any[] = Array.isArray(cm?.group) ? cm.group : [];

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const sourceSystem = typeof group?.source === 'string' ? group.source : undefined;
      const targetSystem = typeof group?.target === 'string' ? group.target : undefined;

      if (sourceSystem && isTxOnlySystem(sourceSystem)) {
        issues.push(createValidationIssue({
          code: 'tx-conceptmap-source-tx-only',
          path: `ConceptMap.group[${gi}].source`,
          resourceType: 'ConceptMap',
          customMessage:
            `Source Code System ${sourceSystem} is only supported on the terminology server, ` +
            `so the source codes are not validated for performance reasons`,
          severityOverride: 'information',
        }));
      }

      const targetCs = getCachedCodeSystem(targetSystem);
      if (!targetCs) continue;

      const elements: any[] = Array.isArray(group?.element) ? group.element : [];
      for (let ei = 0; ei < elements.length; ei++) {
        const targets: any[] = Array.isArray(elements[ei]?.target) ? elements[ei].target : [];
        for (let ti = 0; ti < targets.length; ti++) {
          const t = targets[ti];
          if (typeof t?.code !== 'string' || typeof t.display !== 'string') continue;
          if (!codeSystemHasCode(targetCs, t.code)) continue;
          const expected = codeSystemDisplayFor(targetCs, t.code);
          if (!expected) continue;
          if (expected.toLowerCase() === t.display.toLowerCase()) continue;
          issues.push(createValidationIssue({
            code: 'tx-conceptmap-target-display-invalid',
            path: `ConceptMap.group[${gi}].element[${ei}].target[${ti}].code`,
            resourceType: 'ConceptMap',
            customMessage:
              `The target display '${t.display}' for the code '${targetSystem}#${t.code}' ` +
              `is not valid. Possible displays: '${expected}'`,
            severityOverride: 'warning',
          }));
        }
      }
    }

    return issues;
  }

  /**
   * Validate the `filter[]` array on a compose.include or compose.exclude
   * entry. The entry must carry `system` — filters reference properties on
   * that CodeSystem. Runs three checks per filter:
   *   1. `op` is one of the spec-allowed operators
   *   2. `property` exists on the referenced CodeSystem (if cached)
   *   3. `value` is coherent with `op`/property type:
   *       - `regex` op → value must be a valid JS RegExp
   *       - `=` op on a Coding-typed property → value must be
   *         `system(|version)#code` and the code must exist in the
   *         referenced sub-CodeSystem
   */
  // eslint-disable-next-line max-lines-per-function -- filter validation enumerates three related spec rules
  private validateComposeFilters(
    entry: any,
    pathPrefix: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!entry || !Array.isArray(entry.filter)) return issues;

    const systemUrl: string | undefined = typeof entry.system === 'string' ? entry.system : undefined;
    const targetCs = getCachedCodeSystem(systemUrl);

    for (let f = 0; f < entry.filter.length; f++) {
      const filter = entry.filter[f];
      if (!filter || typeof filter !== 'object') continue;

      const filterPath = `${pathPrefix}.filter[${f}]`;
      const op = typeof filter.op === 'string' ? filter.op : '';
      const property = typeof filter.property === 'string' ? filter.property : '';
      const value = typeof filter.value === 'string' ? filter.value : '';

      // Rule 1: op must be in the allowed set
      if (op && !ALLOWED_FILTER_OPS.has(op)) {
        issues.push(createValidationIssue({
          code: 'tx-valueset-filter-op-invalid',
          path: filterPath,
          resourceType: 'ValueSet',
          customMessage:
            `The filter operation '${op}' is not a valid operation ` +
            `(must be one of: ${Array.from(ALLOWED_FILTER_OPS).join(', ')})`,
          severityOverride: 'error',
        }));
      }

      // Rule 2: property must exist on the referenced CodeSystem (if known).
      // `property` can resolve to either a `CodeSystem.property[].code` entry
      // (actual concept property) or a `CodeSystem.filter[].code` entry
      // (predefined filter alias) — either is accepted by the FHIR validator.
      const csProperties: any[] = Array.isArray((targetCs as any)?.property)
        ? (targetCs as any).property
        : [];
      const csFilters: any[] = Array.isArray((targetCs as any)?.filter)
        ? (targetCs as any).filter
        : [];
      const propDef = property
        ? csProperties.find((p: any) => p?.code === property)
        : undefined;
      const filterDef = property
        ? csFilters.find((f: any) => f?.code === property)
        : undefined;

      const hasKnownDefs = csProperties.length > 0 || csFilters.length > 0;
      if (targetCs && property && hasKnownDefs && !propDef && !filterDef) {
        issues.push(createValidationIssue({
          code: 'tx-valueset-filter-property-unknown',
          path: filterPath,
          resourceType: 'ValueSet',
          customMessage:
            `The property '${property}' is not defined on the CodeSystem '${systemUrl}'`,
          severityOverride: 'error',
        }));
      }

      // Rule 3: value must be coherent with op/property type
      if (op === 'regex' && value) {
        try {
          // Construct purely to test parseability; the compiled RegExp
          // is intentionally discarded.
          void new RegExp(value);
        } catch {
          issues.push(createValidationIssue({
            code: 'tx-valueset-filter-value-invalid-regex',
            path: filterPath,
            resourceType: 'ValueSet',
            customMessage:
              `The filter value '${value}' is not a valid regular expression`,
            severityOverride: 'error',
          }));
        }
      }

      if (op === '=' && propDef?.type === 'Coding' && value) {
        const parsed = parseSystemVersionCode(value);
        if (!parsed) {
          issues.push(createValidationIssue({
            code: 'tx-valueset-filter-value-format',
            path: filterPath,
            resourceType: 'ValueSet',
            customMessage:
              `The value for a filter based on property '${property}' must be ` +
              `in the format system(|version)#code, not '${value}'`,
            severityOverride: 'error',
          }));
        } else {
          const subCs = getCachedCodeSystem(parsed.system);
          if (subCs && !codeSystemHasCode(subCs, parsed.code)) {
            const subVersion = typeof subCs.version === 'string' ? subCs.version : 'null';
            issues.push(createValidationIssue({
              code: 'tx-valueset-filter-value-unknown-code',
              path: filterPath,
              resourceType: 'ValueSet',
              customMessage:
                `The value for a filter based on property '${property}' is '${value}' ` +
                `which is not a valid code (Unknown code '${parsed.code}' in the CodeSystem ` +
                `'${parsed.system}' version '${subVersion}')`,
              severityOverride: 'error',
            }));
          }
        }
      }
    }

    return issues;
  }

  /**
   * Validate a CodeSystem contained within a ValueSet.
   * Applies the same canonical-URL and caseSensitive checks.
   */
  private validateContainedCodeSystem(cs: any, index: number): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const url = typeof cs.url === 'string' ? cs.url : '';
    const pathPrefix = `ValueSet.contained[${index}]`;
    const hl7 = isHl7Url(url);

    // Canonical URL must be absolute
    if (url && !isAbsoluteUri(url)) {
      issues.push(createValidationIssue({
        code: 'tx-codesystem-url-not-absolute',
        path: `${pathPrefix}.url`,
        resourceType: 'ValueSet',
        customMessage:
          `Canonical URLs in contained resources must be absolute URLs if present (${url})`,
        severityOverride: 'error',
      }));
    }

    // urn:uuid: must be valid
    if (url.startsWith('urn:uuid:')) {
      const { valid, uuid } = validateUrnUuid(url);
      if (!valid) {
        issues.push(createValidationIssue({
          code: 'tx-codesystem-url-invalid-uuid',
          path: `${pathPrefix}.url`,
          resourceType: 'ValueSet',
          customMessage: `UUIDs must be valid and lowercase (${uuid})`,
          severityOverride: 'error',
        }));
      }
    }

    // caseSensitive SHOULD be stated (skip for content=not-present/fragment)
    const contentDefinesCodes = cs.content === 'complete' || cs.content === 'example' || cs.content === 'supplement';
    if (contentDefinesCodes && (cs.caseSensitive === undefined || cs.caseSensitive === null)) {
      const severity = hl7 ? 'warning' : 'information';
      const prefix = hl7 ? 'HL7 Defined ' : '';
      issues.push(createValidationIssue({
        code: 'tx-codesystem-missing-casesensitive',
        path: pathPrefix,
        resourceType: 'ValueSet',
        customMessage:
          `${prefix}CodeSystems SHOULD have a stated value for the caseSensitive element ` +
          `so that users know the status and meaning of the code system clearly`,
        severityOverride: severity,
      }));
    }

    // HL7 concepts SHOULD have a definition
    if (hl7 && Array.isArray(cs.concept)) {
      for (let i = 0; i < cs.concept.length; i++) {
        const concept = cs.concept[i];
        if (concept && !concept.definition) {
          issues.push(createValidationIssue({
            code: 'tx-codesystem-concept-no-definition',
            path: `${pathPrefix}.concept[${i}]`,
            resourceType: 'ValueSet',
            customMessage:
              `HL7 Defined CodeSystems should ensure that every concept has a definition`,
            severityOverride: 'warning',
          }));
          break;
        }
      }
    }

    return issues;
  }
}

// Singleton
export const terminologyResourceValidator = new TerminologyResourceValidator();
