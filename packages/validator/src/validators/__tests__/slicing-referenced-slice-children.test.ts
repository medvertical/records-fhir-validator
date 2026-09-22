import { describe, expect, it } from "vitest";
import { collectReferencedSliceChildren } from "../slice-profile-element-reference";

describe('slices defined by reference into another profile', () => {
  it('resolves a named slice in a referenced profile down to its children', () => {
    // The slice carries no inline pattern; it delegates to a named slice in a
    // library profile. Without following that reference the discriminator is
    // unresolvable and required slices are never checked.
    const elements = [
      { path: 'Composition' },
      { path: 'Composition.section', slicing: { discriminator: [{ type: 'pattern', path: 'code' }], rules: 'open' } },
      { path: 'Composition.section', sliceName: 'codeA' },
      { path: 'Composition.section.code', patternCodeableConcept: { coding: [{ code: 'A' }] } },
    ] as unknown as Parameters<typeof collectReferencedSliceChildren>[0];

    const resolved = collectReferencedSliceChildren(elements, 'Composition.section:codeA');
    expect(resolved?.map(([relativePath]) => relativePath)).toEqual(['code']);
  });

  it('stops at the next sibling slice rather than swallowing it', () => {
    const elements = [
      { path: 'Composition.section', sliceName: 'codeB' },
      { path: 'Composition.section.code', patternCodeableConcept: { text: 'B' } },
      { path: 'Composition.section', sliceName: 'codeA' },
      { path: 'Composition.section.code', patternCodeableConcept: { text: 'A' } },
    ] as unknown as Parameters<typeof collectReferencedSliceChildren>[0];

    const resolved = collectReferencedSliceChildren(elements, 'Composition.section:codeB');
    expect(resolved).toHaveLength(1);
    expect((resolved?.[0][1] as { patternCodeableConcept: { text: string } }).patternCodeableConcept.text).toBe('B');
  });

  it('returns undefined when the referenced slice is absent', () => {
    const elements = [{ path: 'Composition.section', sliceName: 'other' }] as unknown as
      Parameters<typeof collectReferencedSliceChildren>[0];
    expect(collectReferencedSliceChildren(elements, 'Composition.section:codeA')).toBeUndefined();
  });
});
