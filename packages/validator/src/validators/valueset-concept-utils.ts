import type { CodeSystem, CodeSystemConcept } from './valueset-types';
import { logger } from '../logger';

export function applyConceptFilter(
    codeSystem: CodeSystem,
    filter: { property: string; op: string; value: string },
): string[] {
    if (filter.property !== 'concept') return [];

    if (filter.op === '=') {
        const match = findConcept(codeSystem.concept, filter.value);
        return match ? [match.code] : [];
    }

    if (filter.op === 'is-a') {
        const root = findConcept(codeSystem.concept, filter.value);
        if (!root) return [];
        return collectDescendants(root);
    }

    if (filter.op === 'descendent-of') {
        const root = findConcept(codeSystem.concept, filter.value);
        if (!root) return [];
        return collectDescendants(root).filter(c => c !== root.code);
    }

    return [];
}

export function extractCodesFromCodeSystem(codeSystem: CodeSystem): string[] {
    if (codeSystem.content === 'supplement') {
        logger.debug(
            `[ValueSetPackageLoader] Skipping supplement CodeSystem ${codeSystem.url} — codes must come from base system ${codeSystem.supplements}`,
        );
        return [];
    }

    const codes: string[] = [];
    extractNestedCodes(codeSystem.concept, codes);
    return codes;
}

function findConcept(
    concepts: CodeSystemConcept[] | undefined,
    code: string,
): CodeSystemConcept | null {
    if (!concepts) return null;
    for (const concept of concepts) {
        if (concept.code === code) return concept;
        const nested = findConcept(concept.concept, code);
        if (nested) return nested;
    }
    return null;
}

function collectDescendants(root: CodeSystemConcept): string[] {
    const out: string[] = [];
    const walk = (concept: CodeSystemConcept): void => {
        if (concept.code) out.push(concept.code);
        if (concept.concept) {
            for (const child of concept.concept) walk(child);
        }
    };
    walk(root);
    return out;
}

function extractNestedCodes(concepts: CodeSystemConcept[] | undefined, codes: string[]): void {
    if (!concepts) return;
    for (const concept of concepts) {
        if (concept.code) {
            codes.push(concept.code);
        }
        if (concept.concept) {
            extractNestedCodes(concept.concept, codes);
        }
    }
}
