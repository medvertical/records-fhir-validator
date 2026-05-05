/**
 * compliesWithProfile slicing helpers.
 *
 * Java raises three slicing-related diagnostics when a derived profile
 * fails to honour the slicing structure declared by the claimed parent:
 *
 *   • Mismatch in slicing rules at <path>: '<derived>' when the claimed
 *     profile has '<base>'   (open/closed mismatch)
 *   • Mismatch in slicing at <slice-id>: no slice found for the
 *     discriminator <type>:<path> with the values <FhirType>[<value>]
 *   • Mismatch in slicing at <path>: extra slice '<name>' not found in
 *     the claimed profile  (closed-rule violation)
 *
 * This module computes those diagnostics from the differentials. It does
 * not attempt full snapshot reconstruction — the conformance fixtures
 * carry only differentials.
 */

const PATTERN_PREFIX = 'pattern';
const FIXED_PREFIX = 'fixed';

interface DiscriminatorValue {
  type: string;        // value | pattern | type | profile | exists
  path: string;        // sub-element path within the slice
  fhirType: string;    // capitalized FHIR primitive type (Uri, Code, ...)
  value: string;       // serialised primitive value
}

interface SliceRecord {
  id: string;          // e.g. Patient.identifier:mrn
  parentPath: string;  // e.g. Patient.identifier
  sliceName: string;
  min?: number;
  discriminatorValues: DiscriminatorValue[];
}

interface SlicingParent {
  parentPath: string;
  rules?: string;             // open | closed | openAtEnd
  discriminators: Array<{ type?: string; path?: string }>;
  slices: SliceRecord[];
}

/**
 * Index slicing parents and the slice records below them out of an
 * SD's differential / snapshot element list.
 */
export function indexSlicingParents(elements: any[]): Map<string, SlicingParent> {
  const parents = new Map<string, SlicingParent>();

  for (const el of elements) {
    if (!el?.path) continue;
    if (!el.slicing) continue;
    parents.set(el.path, {
      parentPath: el.path,
      rules: el.slicing?.rules,
      discriminators: el.slicing?.discriminator || [],
      slices: [],
    });
  }

  for (const el of elements) {
    if (!el?.id || !el.sliceName) continue;
    const parentPath = el.path; // sliced elements share the parent path
    const parent = parents.get(parentPath);
    if (!parent) continue;
    parent.slices.push({
      id: el.id,
      parentPath,
      sliceName: el.sliceName,
      min: typeof el.min === 'number' ? el.min : undefined,
      discriminatorValues: extractDiscriminatorValues(el, elements, parent.discriminators),
    });
  }
  return parents;
}

function extractDiscriminatorValues(
  sliceElem: any,
  allElements: any[],
  discriminators: Array<{ type?: string; path?: string }>,
): DiscriminatorValue[] {
  const out: DiscriminatorValue[] = [];
  for (const disc of discriminators) {
    if (!disc?.path) continue;
    const value = readDiscriminatorValue(sliceElem, allElements, disc);
    if (value) out.push(value);
  }
  return out;
}

function readDiscriminatorValue(
  sliceElem: any,
  allElements: any[],
  disc: { type?: string; path?: string },
): DiscriminatorValue | null {
  const discType = disc.type || 'value';
  const discPath = disc.path || '';

  // Inline pattern[X] / fixed[X] on the slice itself (e.g. patternIdentifier)
  // resolves the sub-path against the inlined object.
  for (const key of Object.keys(sliceElem || {})) {
    if (!key.startsWith(PATTERN_PREFIX) && !key.startsWith(FIXED_PREFIX)) continue;
    const fhirType = capitalize(
      key.slice(key.startsWith(PATTERN_PREFIX) ? PATTERN_PREFIX.length : FIXED_PREFIX.length)
    );
    const subValue = pluckPath(sliceElem[key], discPath);
    if (typeof subValue === 'string') {
      return { type: discType, path: discPath, fhirType, value: subValue };
    }
  }

  // Sub-element approach: Patient.identifier:mrn.system → look up the
  // child element with id = `${slice.id}.${discPath}`.
  const childId = `${sliceElem.id}.${discPath}`;
  const child = allElements.find((e) => e?.id === childId);
  if (!child) return null;
  for (const key of Object.keys(child)) {
    if (!key.startsWith(PATTERN_PREFIX) && !key.startsWith(FIXED_PREFIX)) continue;
    const fhirType = capitalize(
      key.slice(key.startsWith(PATTERN_PREFIX) ? PATTERN_PREFIX.length : FIXED_PREFIX.length)
    );
    const raw = child[key];
    if (typeof raw === 'string') {
      return { type: discType, path: discPath, fhirType, value: raw };
    }
  }
  return null;
}

function pluckPath(obj: any, path: string): any {
  if (obj == null) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface SlicingDiff {
  rulesMismatchPath?: string;
  rulesMismatchBase?: string;
  rulesMismatchDerived?: string;
  missingRequiredSlices: SliceRecord[];   // base slices with min≥1 with no derived match
  extraInClosedSlices: SliceRecord[];     // derived slices absent from a closed-rule base
}

/**
 * Compare slicing parents between derived and base differentials and
 * report rule-level / slice-level mismatches. Slice matching uses the
 * discriminator values declared on each side rather than slice names.
 */
export function diffSlicing(
  baseElements: any[],
  derivedElements: any[],
): SlicingDiff[] {
  const baseParents = indexSlicingParents(baseElements);
  const derivedParents = indexSlicingParents(derivedElements);
  const diffs: SlicingDiff[] = [];

  for (const [parentPath, baseParent] of baseParents) {
    const derivedParent = derivedParents.get(parentPath);
    const diff: SlicingDiff = {
      missingRequiredSlices: [],
      extraInClosedSlices: [],
    };

    if (derivedParent && baseParent.rules === 'closed' && derivedParent.rules && derivedParent.rules !== 'closed') {
      diff.rulesMismatchPath = parentPath;
      diff.rulesMismatchBase = baseParent.rules;
      diff.rulesMismatchDerived = derivedParent.rules;
    }

    // Open-rule slicing: only slices with min ≥ 1 are mandatory in the
    // derived. Closed-rule slicing: every base slice must be carried
    // forward (Java reports each missing slice individually).
    const closedRules = baseParent.rules === 'closed';
    for (const baseSlice of baseParent.slices) {
      const required = closedRules || (baseSlice.min ?? 0) >= 1;
      if (!required) continue;
      const match = derivedParent?.slices.find((d) => slicesMatch(baseSlice, d));
      if (!match) diff.missingRequiredSlices.push(baseSlice);
    }

    if (closedRules && derivedParent && !diff.rulesMismatchPath) {
      for (const derivedSlice of derivedParent.slices) {
        const match = baseParent.slices.find((b) => slicesMatch(b, derivedSlice));
        if (!match) diff.extraInClosedSlices.push(derivedSlice);
      }
    }

    diffs.push(diff);
  }

  return diffs;
}

function slicesMatch(a: SliceRecord, b: SliceRecord): boolean {
  // Without discriminator values we have no reliable way to match — fall
  // back to slice-name equality so trivially identical slicings still pair.
  if (a.discriminatorValues.length === 0 || b.discriminatorValues.length === 0) {
    return a.sliceName === b.sliceName;
  }
  if (a.discriminatorValues.length !== b.discriminatorValues.length) return false;
  for (const av of a.discriminatorValues) {
    const found = b.discriminatorValues.find(
      (bv) => bv.type === av.type && bv.path === av.path
        && bv.fhirType === av.fhirType && bv.value === av.value,
    );
    if (!found) return false;
  }
  return true;
}

export function describeMissingRequiredSlice(slice: SliceRecord): string {
  const disc = slice.discriminatorValues[0];
  if (!disc) {
    return `Mismatch in slicing at ${slice.id}: no slice found`;
  }
  return `Mismatch in slicing at ${slice.id}: no slice found for the discriminator ${disc.type}:${disc.path} with the values ${disc.fhirType}Type[${disc.value}]`;
}

export function describeExtraSlice(parentPath: string, slice: SliceRecord): string {
  return `Mismatch in slicing at ${parentPath}: extra slice '${slice.sliceName}' not found in the claimed profile`;
}

export function describeRulesMismatch(diff: SlicingDiff): string {
  return `Mismatch in slicing rules at ${diff.rulesMismatchPath}: '${diff.rulesMismatchDerived}' when the claimed profile has '${diff.rulesMismatchBase}'`;
}
