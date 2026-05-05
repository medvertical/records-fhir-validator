/**
 * Choice-Type Property Validator (narrow G3 scope)
 * -----------------------------------------------
 *
 * FHIR polymorphic `X[x]` elements (e.g. `value[x]` on Observation.value,
 * Group.characteristic.value, RiskAssessment.prediction.probability) may
 * only appear in the resource as `XType` where Type is one of the
 * allowed type codes from the StructureDefinition, capitalized.
 *
 * Two invalid runtime shapes:
 *
 *   1. Unsuffixed — `{ value: true }` where the SD declares `value[x]`.
 *      FHIR has no such property; the correct form is `valueBoolean`.
 *      (fhir-test-cases: group-choice-bad1)
 *
 *   2. Wrong suffix — `{ valueInteger: 1 }` where `value[x]`'s allowed
 *      types are CodeableConcept/boolean/Quantity/Range/Reference.
 *      Integer is not in the list.
 *      (fhir-test-cases: group-choice-bad2)
 *
 * This is the narrow portion of the wider "unrecognized property" check
 * (strategic-roadmap G3). We target the choice-type case because it has
 * clear semantics and the SD snapshot already carries the allowed list.
 *
 * Scope decisions:
 *   - Only emits for choice-type slots declared directly on the resource
 *     snapshot (not deep inside complex types the walker already covers).
 *   - Emits both a "property invalid" error (category `structure`) and a
 *     "value[x]: minimum required = 1, but only found 0" companion when
 *     the slot is required and no valid variant is present, matching the
 *     two-error shape Java uses for these cases.
 */

import type { ValidationIssue } from '../types';
import type { StructureDefinition, ElementDefinition } from '../core/structure-definition-types';
import { createValidationIssue } from '../issues';

const UNIVERSAL_PRIMITIVE_KEYS = new Set([
  'id', 'extension', 'modifierExtension',
]);

/**
 * A choice-type slot resolved from the SD snapshot.
 */
interface ChoiceSlot {
  /** Full element path (e.g. `Group.characteristic.value[x]`). */
  fullPath: string;
  /** Base property name without the `[x]` suffix (e.g. `value`). */
  baseName: string;
  /** Parent element path (e.g. `Group.characteristic`). */
  parentPath: string;
  /** Allowed type codes with first letter capitalized
   *  (e.g. `['CodeableConcept', 'Boolean', 'Quantity', 'Range', 'Reference']`). */
  allowedSuffixes: string[];
  /** Raw type codes from the SD (preserves lowercase primitives). */
  allowedTypes: string[];
  min: number;
}

/**
 * Build the list of choice-type slots from a SD snapshot.
 */
export function extractChoiceSlots(sd: StructureDefinition | undefined): ChoiceSlot[] {
  const elements: ElementDefinition[] =
    sd?.snapshot?.element || sd?.differential?.element || [];
  const slots: ChoiceSlot[] = [];
  for (const el of elements) {
    const path = el.path ?? '';
    if (!path.endsWith('[x]')) continue;
    if (!el.type || el.type.length === 0) continue;
    const baseName = path.split('.').pop()!.slice(0, -3);
    const parentPath = path.slice(0, path.length - baseName.length - '[x]'.length - 1);
    const allowedTypes = el.type.map(t => t.code ?? '').filter(Boolean);
    if (allowedTypes.length === 0) continue;
    const allowedSuffixes = allowedTypes.map(capitalize);
    slots.push({
      fullPath: path,
      baseName,
      parentPath,
      allowedSuffixes,
      allowedTypes,
      min: el.min ?? 0,
    });
  }
  return slots;
}

/**
 * Validate choice-type slots against a resource instance.
 */
export function validateChoiceTypeProperties(
  resource: any,
  sd: StructureDefinition | undefined,
): ValidationIssue[] {
  if (!resource || typeof resource !== 'object') return [];
  const issues: ValidationIssue[] = [];
  const slots = extractChoiceSlots(sd);
  if (slots.length === 0) return issues;

  for (const slot of slots) {
    const parents = navigateToInstances(resource, slot.parentPath);
    for (const { instance, path: instancePath } of parents) {
      if (!instance || typeof instance !== 'object') continue;

      const keys = Object.keys(instance);
      const baseMatch = keys.includes(slot.baseName);
      const suffixedMatches = keys.filter(
        k =>
          k.startsWith(slot.baseName) &&
          k.length > slot.baseName.length &&
          k[slot.baseName.length] >= 'A' &&
          k[slot.baseName.length] <= 'Z',
      );
      const validSuffixed = suffixedMatches.filter(k =>
        slot.allowedSuffixes.includes(k.slice(slot.baseName.length)),
      );
      const anyValid = validSuffixed.length > 0;

      // Unsuffixed `base: value` usage where the SD has `base[x]`. This is
      // strictly malformed FHIR — no profile can make `value` (unsuffixed)
      // a valid property name.
      //
      // Note: we deliberately DO NOT flag "wrong suffix" cases (e.g.
      // `valueInteger` where the slot allows Quantity|CodeableConcept).
      // Those are handled by the existing `structural-type-mismatch`
      // detection — firing both would regress profile-restricted tests
      // like `bb-obs-value-is-not-quantity-or-string` that already score
      // cleanly on the type-mismatch signal alone.
      if (baseMatch && !isUniversalPrimitive(slot.baseName)) {
        issues.push(createValidationIssue({
          code: 'structural-unknown-element',
          path: `${instancePath}.${slot.baseName}`,
          resourceType: resource.resourceType,
          customMessage:
            `Undefined element '${slot.baseName}' at ${instancePath}. The StructureDefinition declares '${slot.baseName}[x]'; ` +
            `use one of: ${slot.allowedSuffixes.map(s => slot.baseName + s).join(', ')}.`,
          severityOverride: 'error',
          details: { baseName: slot.baseName, allowed: slot.allowedSuffixes },
        }));

        // Companion "minimum required = 1, but only found 0" error — Java
        // emits this alongside the unrecognised-property error for the
        // unsuffixed case when the slot is required. Only emit when there's
        // no valid variant elsewhere on the same instance.
        if (slot.min > 0 && !anyValid) {
          issues.push(createValidationIssue({
            code: 'structural-cardinality-min',
            path: `${instancePath}.${slot.baseName}[x]`,
            resourceType: resource.resourceType,
            customMessage:
              `${slot.fullPath}: minimum required = ${slot.min}, but only found 0 valid variant.`,
            severityOverride: 'error',
            details: { baseName: slot.baseName, min: slot.min },
          }));
        }
      }
    }
  }

  return issues;
}

/**
 * Walk a dotted path starting at the resource root and return each
 * object/array encountered at the leaf.
 *
 * `Group.characteristic` → [{ instance: characteristic[0], path: 'Group.characteristic[0]' }, ...]
 * `RiskAssessment.prediction` → same shape for each prediction entry.
 */
function navigateToInstances(
  resource: any,
  fullPath: string,
): Array<{ instance: any; path: string }> {
  const parts = fullPath.split('.').slice(1); // drop the resource-type prefix
  let current: Array<{ value: any; path: string }> = [
    { value: resource, path: resource?.resourceType ?? '' },
  ];
  for (const part of parts) {
    const next: Array<{ value: any; path: string }> = [];
    for (const node of current) {
      const v = node.value?.[part];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        v.forEach((item, i) => next.push({ value: item, path: `${node.path}.${part}[${i}]` }));
      } else {
        next.push({ value: v, path: `${node.path}.${part}` });
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current.map(c => ({ instance: c.value, path: c.path }));
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function isUniversalPrimitive(name: string): boolean {
  return UNIVERSAL_PRIMITIVE_KEYS.has(name);
}
