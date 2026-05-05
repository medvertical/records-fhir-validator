/**
 * Terminology Executor
 * 
 * Validates terminology bindings:
 * - ValueSet binding validation
 * - CodeSystem validation
 * - Terminology expansion
 * - Binding strength enforcement
 */

import type { ValidationIssue } from '../../types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';
import { ValueSetValidator, type TerminologyResolutionConfig } from '../../validators/valueset-validator';
import { shouldValidateRequired } from '../../business-rules';
import { validateUcumCode, quantityUsesUcum } from '../../validators/ucum-validator';
import { logger } from '../../logger';

// FHIR types whose `code` field carries a UCUM expression when `system`
// is `http://unitsofmeasure.org`. Simple- and Money-quantities share the
// shape via constraints; all of them land in this executor via their
// element's `type.code`.
const UCUM_BEARING_TYPES = new Set<string>([
  'Quantity', 'SimpleQuantity', 'MoneyQuantity',
  'Age', 'Distance', 'Duration', 'Count',
]);

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

// ============================================================================
// Types
// ============================================================================

export interface TerminologyValidationContext {
  resource: any;
  structureDef: StructureDefinition;
  getValueAtPath: (resource: any, path: string) => any;
}

// ============================================================================
// Helpers
// ============================================================================

/** Quantity unit bindings: required → extensible. HAPI-aligned — avoids FP on derived profiles
 *  (e.g. Pulse Oximetry L/min vs. Vital Signs ucum-vitals-common). */
function effectiveBindingForElement(elementDef: { binding?: any; type?: { code: string }[] }): any {
  const binding = elementDef.binding;
  if (binding?.strength !== 'required') return binding;
  const hasQuantityType = elementDef.type?.some(t => UCUM_BEARING_TYPES.has(t.code));
  return hasQuantityType ? { ...binding, strength: 'extensible' } : binding;
}

function shouldValidateBindingForValue(
  elementDef: { path?: string; type?: { code: string }[] },
  value: unknown,
): boolean {
  if (!elementDef.path?.endsWith('[x]')) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;

  const candidate = value as Record<string, unknown>;
  const quantityLike = typeof candidate.value === 'number' &&
    typeof candidate.system === 'string' &&
    typeof candidate.code === 'string';

  return !quantityLike;
}

function codingMatchesPattern(coding: unknown, pattern: Record<string, unknown>): boolean {
  if (!coding || typeof coding !== 'object' || Array.isArray(coding)) return false;
  const candidate = coding as Record<string, unknown>;
  return Object.entries(pattern).every(([key, value]) => candidate[key] === value);
}

function codeableConceptMatchesPattern(value: unknown, pattern: Record<string, unknown>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  return Object.entries(pattern).every(([key, expected]) => {
    if (key === 'coding' && Array.isArray(expected)) {
      const candidateCodings = Array.isArray(candidate.coding) ? candidate.coding : [];
      return expected.every(patternCoding =>
        candidateCodings.some(candidateCoding =>
          codingMatchesPattern(candidateCoding, patternCoding as Record<string, unknown>),
        ),
      );
    }

    return candidate[key] === expected;
  });
}

function elementMatchesOwnPattern(elementDef: ElementDefinition, value: unknown): boolean {
  const patternCoding = (elementDef as ElementDefinition & { patternCoding?: Record<string, unknown> }).patternCoding;
  if (patternCoding) return codingMatchesPattern(value, patternCoding);

  const patternCodeableConcept = (
    elementDef as ElementDefinition & { patternCodeableConcept?: Record<string, unknown> }
  ).patternCodeableConcept;
  if (patternCodeableConcept) return codeableConceptMatchesPattern(value, patternCodeableConcept);

  return false;
}

function getPatternOrFixedValue(elementDef: ElementDefinition): unknown {
  const candidate = elementDef as ElementDefinition & Record<string, unknown>;
  if (candidate.pattern !== undefined) return candidate.pattern;
  if (candidate.fixed !== undefined) return candidate.fixed;
  for (const key of Object.keys(candidate)) {
    if ((key.startsWith('pattern') || key.startsWith('fixed')) && key !== 'pattern' && key !== 'fixed') {
      return candidate[key];
    }
  }
  return undefined;
}

function getValueAtRelativePath(value: unknown, path: string): unknown {
  if (!path || path === '$this') return value;
  if (!value || typeof value !== 'object') return undefined;

  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getSliceChildConstraints(structureDef: StructureDefinition, elementDef: ElementDefinition): ElementDefinition[] {
  if (!elementDef.id || !elementDef.sliceName) return [];
  const prefix = `${elementDef.id}.`;
  return structureDef.snapshot?.element.filter(candidate =>
    typeof candidate.id === 'string' &&
    candidate.id.startsWith(prefix) &&
    getPatternOrFixedValue(candidate) !== undefined,
  ) ?? [];
}

function elementMatchesSliceChildConstraints(
  value: unknown,
  elementDef: ElementDefinition,
  structureDef: StructureDefinition,
): boolean {
  const constraints = getSliceChildConstraints(structureDef, elementDef);
  if (constraints.length === 0) return false;

  return constraints.every(constraint => {
    const relativePath = constraint.id!.substring(`${elementDef.id}.`.length);
    return getValueAtRelativePath(value, relativePath) === getPatternOrFixedValue(constraint);
  });
}

function getSiblingSlicePatterns(structureDef: StructureDefinition, elementDef: ElementDefinition): ElementDefinition[] {
  const elementId = elementDef.id;
  if (!elementId || !elementDef.sliceName) return [];

  const slicePrefix = elementId.slice(0, elementId.lastIndexOf(':') + 1);
  return structureDef.snapshot?.element.filter(candidate =>
    candidate.id !== elementId &&
    candidate.id?.startsWith(slicePrefix) &&
    candidate.path === elementDef.path &&
    Boolean(
      (candidate as ElementDefinition & { patternCoding?: unknown }).patternCoding ||
      (candidate as ElementDefinition & { patternCodeableConcept?: unknown }).patternCodeableConcept
    ),
  ) ?? [];
}

function selectValuesForBinding(
  elementDef: ElementDefinition,
  value: unknown,
  structureDef: StructureDefinition,
): unknown[] {
  const values = Array.isArray(value) ? value : [value];

  if (!elementDef.sliceName) {
    return values;
  }

  const patternCoding = (elementDef as ElementDefinition & { patternCoding?: Record<string, unknown> }).patternCoding;
  if (patternCoding) {
    if (Array.isArray(value)) {
      return value.filter(item => codingMatchesPattern(item, patternCoding));
    }

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as Record<string, unknown>).coding)
    ) {
      return ((value as Record<string, unknown>).coding as unknown[])
        .filter(item => codingMatchesPattern(item, patternCoding));
    }

    return codingMatchesPattern(value, patternCoding) ? [value] : [];
  }

  const patternCodeableConcept = (
    elementDef as ElementDefinition & { patternCodeableConcept?: Record<string, unknown> }
  ).patternCodeableConcept;
  if (patternCodeableConcept) {
    return values.filter(item => codeableConceptMatchesPattern(item, patternCodeableConcept));
  }

  const ownChildConstraints = getSliceChildConstraints(structureDef, elementDef);
  if (ownChildConstraints.length > 0) {
    return values.filter(item => elementMatchesSliceChildConstraints(item, elementDef, structureDef));
  }

  const siblingPatterns = getSiblingSlicePatterns(structureDef, elementDef);
  if (siblingPatterns.length > 0) {
    return values.filter(item => !siblingPatterns.some(sibling => elementMatchesOwnPattern(sibling, item)));
  }

  return [value];
}

// ============================================================================
// Terminology Executor
// ============================================================================

export class TerminologyExecutor {
  private valuesetValidator: ValueSetValidator;

  constructor() {
    this.valuesetValidator = new ValueSetValidator();
  }

  /**
   * Configure terminology resolution strategy
   * Call this when settings change to update the underlying ValueSetValidator
   */
  configureResolution(config: Partial<TerminologyResolutionConfig>): void {
    this.valuesetValidator.setResolutionConfig(config);
    logger.info(`[TerminologyExecutor] Resolution configured: strategy=${config.strategy}`);
  }

  /**
   * Get current resolution configuration
   */
  getResolutionConfig(): TerminologyResolutionConfig {
    return this.valuesetValidator.getResolutionConfig();
  }

  /**
   * Clear caches (call on settings change)
   */
  clearCache(): void {
    this.valuesetValidator.clearCache();
    logger.info('[TerminologyExecutor] Cache cleared');
  }

  /**
   * Validate terminology bindings
   */
  async validate(
    context: TerminologyValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const { resource, structureDef, getValueAtPath } = context;
      const profileUrl = structureDef.url;

      // Validate value set bindings
      if (structureDef.snapshot?.element) {
        for (const elementDef of structureDef.snapshot.element) {
          if (elementDef.binding) {
            const path = elementDef.path;
            const value = getValueAtPath(resource, path);

            // For required bindings, check if value is present
            if (elementDef.binding.strength === 'required') {
              const isRequired = (elementDef.min !== undefined && elementDef.min > 0);

              if (isRequired && (value === null || value === undefined)) {
                // Use same parent-exists check as structural validator
                // This prevents false positives for paths like Patient.communication.language
                // when Patient.communication doesn't exist
                if (shouldValidateRequired(resource, path)) {
                  issues.push({
                    id: `terminology-required-binding-missing-${Date.now()}`,
                    aspect: 'terminology',
                    severity: 'error',
                    code: 'binding-required-missing',
                    message: `Required binding for '${path}' is missing (binding strength: required)`,
                    path: path,
                    timestamp: new Date(),
                    profile: profileUrl
                  });
                }
                continue;
              }
            }

            // Validate code if value is present
            if (value !== null && value !== undefined) {
              if (shouldValidateBindingForValue(elementDef, value)) {
                // Quantity unit bindings: required → extensible (HAPI-aligned, avoids FP on derived profiles)
                const effectiveBinding = effectiveBindingForElement(elementDef);
                for (const candidateValue of selectValuesForBinding(elementDef, value, structureDef)) {
                  const bindingIssues = await this.valuesetValidator.validateBinding(
                    candidateValue, effectiveBinding, path, { profileUrl },
                  );
                  issues.push(...bindingIssues);
                }
              }
            }
          }

          // Validate LOINC/SNOMED codes in Coding elements (external CodeSystems)
          // This catches invalid codes even without explicit ValueSet bindings
          const path = elementDef.path;

          // Check if this element is a CodeableConcept or Coding type
          const elementTypes = elementDef.type?.map(t => t.code) || [];
          const isCodeableConcept = elementTypes.includes('CodeableConcept');
          const isCodingType = elementTypes.includes('Coding');

          if (isCodeableConcept || isCodingType) {
            const value = getValueAtPath(resource, path);
            if (value) {
              // For CodeableConcept, extract the coding array
              // For Coding, use value directly
              const codings = isCodeableConcept ? value.coding : (Array.isArray(value) ? value : [value]);
              if (codings && Array.isArray(codings)) {
                const codingPath = isCodeableConcept ? `${path}.coding` : path;
                const codeSystemIssues = await this.validateExternalCodeSystems(codings, codingPath);
                issues.push(...codeSystemIssues);
              }
            }
          }

          // Validate UCUM codes in Quantity-shaped elements. This covers
          // `Observation.valueQuantity.code`, `Medication.amount.numerator.code`,
          // etc. — places where FHIR embeds a UCUM expression that neither
          // CodeableConcept nor Coding validation would ever see.
          const hasUcumBearingType = elementTypes.some(t => UCUM_BEARING_TYPES.has(t));
          const isPolymorphicWithQuantity = path.endsWith('[x]') && hasUcumBearingType;
          if (hasUcumBearingType || isPolymorphicWithQuantity) {
            const ucumIssues = this.validateUcumAtPath(resource, elementDef, path);
            issues.push(...ucumIssues);
          }
        }
      }

      issues.push(...this.validateKnownLoincDisplays(resource));
      issues.push(...this.validateCodingHygiene(resource, issues));

      return issues;

    } catch (error) {
      logger.error('[TerminologyExecutor] Validation error:', error);
      return [{
        id: `terminology-executor-error-${Date.now()}`,
        aspect: 'terminology',
        severity: 'error',
        code: 'validation-error',
        message: `Terminology validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
    }
  }

  /**
   * Walk the resource looking for Quantity-shaped values at the given
   * element definition and validate any UCUM codes they carry.
   *
   * Handles:
   *   - Direct paths (Observation.valueQuantity → `valueQuantity` field)
   *   - Polymorphic `value[x]` → resolves to `valueQuantity`, `valueAge`,
   *     `valueDuration`, etc.
   *   - Array elements (Observation.referenceRange[].low.code)
   *
   * The walk is intentionally shallow: it relies on the structural-
   * executor to have produced the element definition list; we do NOT
   * re-traverse the resource tree beyond the current element's path.
   */
  private validateUcumAtPath(
    resource: any,
    elementDef: any,
    path: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const elementTypes: string[] = elementDef.type?.map((t: any) => t.code) || [];
    const isPolymorphic = path.endsWith('[x]');

    // The element definition path is dotted and uses FHIR's `[x]`
    // polymorphic marker on the final segment when applicable. We
    // walk the resource tree down to the container of the leaf,
    // then either:
    //   - probe the concrete polymorphic key (value[x] → valueQuantity)
    //   - read the leaf directly by name
    const segments = path.split('.');
    const leafSeg = segments[segments.length - 1];
    const parentSegments = segments.slice(1, -1); // drop resource root + leaf

    // Descend to the leaf's containers. Each segment may produce an
    // array of containers when the intermediate element is repeatable.
    let containers: any[] = [resource];
    for (const seg of parentSegments) {
      const next: any[] = [];
      for (const c of containers) {
        if (c === null || c === undefined) continue;
        const v = c[seg];
        if (Array.isArray(v)) {
          for (const item of v) if (item !== null && item !== undefined) next.push(item);
        } else if (v !== undefined && v !== null) {
          next.push(v);
        }
      }
      containers = next;
    }

    // For each container, resolve the leaf value(s) and their emitted
    // FHIR path suffix. A polymorphic element can carry multiple
    // concrete keys on the same container, so we accumulate (value, key)
    // pairs and then walk them uniformly.
    interface LeafHit { value: any; leafName: string; }
    const leaves: LeafHit[] = [];
    for (const c of containers) {
      if (isPolymorphic) {
        const stem = leafSeg.replace('[x]', '');
        for (const t of elementTypes) {
          if (!UCUM_BEARING_TYPES.has(t)) continue;
          const key = stem + t.charAt(0).toUpperCase() + t.slice(1);
          const v = c[key];
          if (v !== undefined && v !== null) leaves.push({ value: v, leafName: key });
        }
      } else {
        const v = c[leafSeg];
        if (v !== undefined && v !== null) leaves.push({ value: v, leafName: leafSeg });
      }
    }

    const basePath = segments.slice(0, -1).join('.');

    for (const hit of leaves) {
      const items = Array.isArray(hit.value) ? hit.value : [hit.value];
      for (let idx = 0; idx < items.length; idx++) {
        const q = items[idx];
        if (!quantityUsesUcum(q)) continue;
        const result = validateUcumCode(q.code);
        if (result.valid) continue;

        const arrayPart = Array.isArray(hit.value) ? `[${idx}]` : '';
        const finalPath = `${basePath}.${hit.leafName}${arrayPart}.code`;

        issues.push({
          id: `terminology-ucum-invalid-${Date.now()}-${idx}`,
          aspect: 'terminology',
          severity: 'error',
          // Reuse the generic `terminology-code-invalid` code so downstream
          // consumers (OperationOutcome converter, defect corpus, fix
          // suggestions) don't need a new branch — UCUM is just another
          // external code system from their POV.
          code: 'terminology-code-invalid',
          message: `Invalid UCUM code '${q.code}' at ${finalPath}: ${result.message}`,
          path: finalPath,
          timestamp: new Date(),
        });
      }
    }

    return issues;
  }

  /**
   * Validate codes in external CodeSystems (LOINC, SNOMED, etc.) via tx.fhir.org
   */
  private async validateExternalCodeSystems(
    value: any,
    path: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Handle array of Coding (e.g., code.coding[])
    const codings = Array.isArray(value) ? value : [value];

    for (let i = 0; i < codings.length; i++) {
      const coding = codings[i];
      if (coding && typeof coding === 'object' && coding.code && !coding.system) {
        const codingPath = Array.isArray(value) ? `${path}[${i}]` : path;
        issues.push({
          id: `terminology-coding-missing-system-${Date.now()}-${i}`,
          aspect: 'terminology',
          severity: 'warning',
          code: 'terminology-code-invalid',
          message: 'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
          path: codingPath,
          timestamp: new Date()
        });
        continue;
      }

      if (coding && typeof coding === 'object' && coding.system && coding.code) {
        // Validate CodeSystem URL is known/valid
        const systemValidation = this.validateCodeSystemUrl(coding.system);
        if (!systemValidation.valid) {
          const systemPath = Array.isArray(value) ? `${path}[${i}].system` : `${path}.system`;
          issues.push({
            id: `terminology-codesystem-not-found-${Date.now()}-${i}`,
            aspect: 'terminology',
            severity: 'warning',
            code: 'not-found',
            message: `Unknown CodeSystem URL: '${coding.system}'`,
            path: systemPath,
            timestamp: new Date()
          });
        }

        if (coding.system === 'http://unitsofmeasure.org') {
          const result = validateUcumCode(coding.code);
          if (!result.valid) {
            const codingPath = Array.isArray(value) ? `${path}[${i}].code` : `${path}.code`;
            issues.push({
              id: `terminology-ucum-coding-invalid-${Date.now()}-${i}`,
              aspect: 'terminology',
              severity: 'error',
              code: 'terminology-code-invalid',
              message: `Invalid UCUM code '${coding.code}' at ${codingPath}: ${result.message}`,
              path: codingPath,
              timestamp: new Date()
            });
          }
        }

        // Only validate codes in known external code systems (LOINC, SNOMED, etc.)
        if (this.valuesetValidator.isExternalCodeSystem(coding.system)) {
          const result = await this.valuesetValidator.validateCodeInCodeSystem(
            coding.code,
            coding.system
          );

          if (!result.valid) {
            const codingPath = Array.isArray(value) ? `${path}[${i}].code` : `${path}.code`;
            issues.push({
              id: `terminology-codesystem-invalid-${Date.now()}-${i}`,
              aspect: 'terminology',
              severity: 'error',
              code: 'terminology-code-invalid',
              message: result.message || `Unknown code '${coding.code}' in CodeSystem '${coding.system}'`,
              path: codingPath,
              timestamp: new Date()
            });
          }
        }
      }
    }

    return issues;
  }

  private validateKnownLoincDisplays(resource: any): ValidationIssue[] {
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
            severity: 'error',
            code: 'terminology-display-mismatch',
            message:
              `Wrong Display Name '${value.display}' for http://loinc.org#${value.code}. ` +
              `Valid display is '${allowedDisplays[0]}'`,
            path: `${path}.display`,
            timestamp: new Date(),
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

  private validateCodingHygiene(resource: any, existingIssues: ValidationIssue[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const seen = new Set(existingIssues.map(issue => `${issue.code}|${issue.path}`));
    const root = resource?.resourceType || 'Resource';

    const pushOnce = (issue: Omit<ValidationIssue, 'id' | 'aspect' | 'timestamp'>): void => {
      const key = `${issue.code}|${issue.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({
        id: `terminology-coding-hygiene-${Date.now()}-${issues.length}`,
        aspect: 'terminology',
        timestamp: new Date(),
        ...issue,
      });
    };

    const visit = (value: any, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }

      if (!value || typeof value !== 'object') return;

      if (typeof value.code === 'string' && !value.system) {
        pushOnce({
          severity: 'warning',
          code: 'terminology-code-invalid',
          message: 'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
          path,
        });
      }

      if (value.system === 'http://unitsofmeasure.org' && typeof value.code === 'string') {
        const result = validateUcumCode(value.code);
        if (!result.valid) {
          pushOnce({
            severity: 'error',
            code: 'terminology-code-invalid',
            message: `Invalid UCUM code '${value.code}' at ${path}.code: ${result.message}`,
            path: `${path}.code`,
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

  /**
   * Validate that a CodeSystem URL is known/valid
   */
  private validateCodeSystemUrl(systemUrl: string): { valid: boolean; message?: string } {
    // Known FHIR CodeSystem URL patterns
    const knownPatterns = [
      // HL7 FHIR CodeSystems
      /^http:\/\/hl7\.org\/fhir\//,
      /^http:\/\/terminology\.hl7\.org\//,
      // External standard CodeSystems
      /^http:\/\/loinc\.org\/?$/,
      /^http:\/\/snomed\.info\/sct/,
      /^http:\/\/unitsofmeasure\.org\/?$/,
      /^http:\/\/www\.nlm\.nih\.gov\/research\/umls\/rxnorm/,
      /^urn:oid:/,
      /^urn:iso:/,
      /^urn:ietf:/,
      /^urn:uuid:/,
      // ICD codes
      /^http:\/\/hl7\.org\/fhir\/sid\/icd/,
      // WHO ATC, ISO, UN, DICOM, CPT, CVX and other standard registries
      /^http:\/\/www\.whocc\.no\/atc/,
      /^http:\/\/unstats\.un\.org\//,
      /^http:\/\/dicom\.nema\.org\//,
      /^http:\/\/www\.ama-assn\.org\/go\/cpt/,
      /^http:\/\/hl7\.org\/fhir\/sid\//,
      /^http:\/\/www\.iso\.org\//,
      /^http:\/\/ihe\.net\//,
      /^http:\/\/ihe-d\.de\//,
      /^http:\/\/nucc\.org\//,
      /^http:\/\/fdasis\.nlm\.nih\.gov/,
      /^http:\/\/ncimeta\.nci\.nih\.gov/,
      /^http:\/\/varnomen\.hgvs\.org/,
      /^http:\/\/www\.genenames\.org/,
      /^http:\/\/clinicaltrials\.gov/,
      /^http:\/\/www\.ada\.org\/snodent/,
      /^http:\/\/cts2\.nlm\.nih\.gov/,
      /^http:\/\/standardterms\.edqm\.eu\/?$/,
      // Country-specific FHIR registries
      /^http:\/\/fhir\.de\//,
      /^http:\/\/fhir\.nl\//,
      /^http:\/\/fhir\.ch\//,
      /^https?:\/\/fhir\.ee\//,
      /^https?:\/\/fhir\.bbmri\.de\//,
      /^http:\/\/fhir\.fi\//,
      // Any HL7 domain
      /^https?:\/\/.*\.hl7\.org\//,
      // BCP-47 (Language codes) - Critical for language validation
      /^urn:ietf:bcp:47$/,
      // Synapxe (Singapore) logic - recognized local system
      /^http:\/\/fhir\.synapxe\.sg\/CodeSystem\//,
    ];

    for (const pattern of knownPatterns) {
      if (pattern.test(systemUrl)) {
        return { valid: true };
      }
    }

    // Check for common invalid patterns
    if (!systemUrl.startsWith('http://') && !systemUrl.startsWith('https://') && !systemUrl.startsWith('urn:')) {
      return { valid: false, message: `CodeSystem URL should be an absolute URI: '${systemUrl}'` };
    }

    // Unknown but potentially valid custom CodeSystem
    // Only flag as warning for completely unknown patterns
    return { valid: false, message: `Unknown CodeSystem URL: '${systemUrl}'` };
  }
}
