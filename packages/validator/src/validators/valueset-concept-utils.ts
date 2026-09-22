import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';
import { collectSubsumedCodes } from './valueset-concept-hierarchy.js';
import { logger } from '../logger.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';

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
        return collectSubsumedCodes(codeSystem, filter.value);
    }

    if (filter.op === 'descendent-of') {
        return collectSubsumedCodes(codeSystem, filter.value).filter(code => code !== filter.value);
    }

    return [];
}

export function extractCodesFromCodeSystem(codeSystem: CodeSystem): string[] {
    if (codeSystem.content === 'supplement') {
        logger.debug('[ValueSetPackageLoader] Skipping supplement CodeSystem', {
            ...terminologyTargetMetadata(codeSystem.url, codeSystem.supplements),
        });
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
