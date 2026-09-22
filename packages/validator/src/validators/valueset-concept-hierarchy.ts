import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';

/**
 * Which codes a `concept is-a <code>` filter selects.
 *
 * A CodeSystem may state its hierarchy by nesting `concept.concept`, or by
 * giving each concept a property that names its parent. HL7 Terminology ships
 * every v3 CodeSystem the second way — `v3-ActCode` is 1 300 concepts flat,
 * each carrying `subsumedBy` — so reading only the nesting made
 * `v3-ActEncounterCode` and its siblings expand to nothing locally and go to a
 * terminology server for an answer the package already holds.
 */

/** The standard meaning of a parent-naming property, whatever it is called. */
const PARENT_PROPERTY_URI = 'http://hl7.org/fhir/concept-properties#parent';

/** The conventional name, for a CodeSystem that declares no property uri. */
const PARENT_PROPERTY_CODE = 'parent';

export function collectSubsumedCodes(codeSystem: CodeSystem, rootCode: string): string[] {
    const concepts = flatten(codeSystem.concept);
    if (!concepts.some(concept => concept.code === rootCode)) return [];

    const children = childrenByParent(codeSystem, concepts);
    const subsumed: string[] = [];
    const seen = new Set<string>();
    const pending = [rootCode];
    while (pending.length > 0) {
        const code = pending.pop()!;
        if (seen.has(code)) continue;
        seen.add(code);
        subsumed.push(code);
        for (const child of children.get(code) ?? []) pending.push(child);
    }
    return subsumed;
}

function flatten(concepts: CodeSystemConcept[] | undefined): CodeSystemConcept[] {
    const out: CodeSystemConcept[] = [];
    const walk = (nodes: CodeSystemConcept[] | undefined): void => {
        for (const node of nodes ?? []) {
            out.push(node);
            walk(node.concept);
        }
    };
    walk(concepts);
    return out;
}

function childrenByParent(
    codeSystem: CodeSystem,
    concepts: readonly CodeSystemConcept[],
): Map<string, string[]> {
    const children = new Map<string, string[]>();
    const add = (parent: string, child: string): void => {
        const existing = children.get(parent);
        if (existing) existing.push(child); else children.set(parent, [child]);
    };

    for (const concept of concepts) {
        for (const nested of concept.concept ?? []) {
            if (concept.code && nested.code) add(concept.code, nested.code);
        }
    }

    const parentProperties = parentPropertyCodes(codeSystem);
    if (parentProperties.size === 0) return children;
    for (const concept of concepts) {
        if (!concept.code) continue;
        for (const property of concept.property ?? []) {
            if (!parentProperties.has(property.code)) continue;
            const parent = property.valueCode ?? property.valueString ?? property.valueCoding?.code;
            if (parent) add(parent, concept.code);
        }
    }
    return children;
}

function parentPropertyCodes(codeSystem: CodeSystem): Set<string> {
    const codes = new Set<string>();
    for (const property of codeSystem.property ?? []) {
        if (property.uri === PARENT_PROPERTY_URI || property.code === PARENT_PROPERTY_CODE) {
            codes.add(property.code);
        }
    }
    return codes;
}
