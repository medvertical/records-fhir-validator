import type {
    CodeSystem,
    ValueSet,
    ValueSetComposeExclude,
    ValueSetComposeInclude,
} from './valueset-types.js';
import { logger } from '../logger.js';
import { applyConceptFilter, extractCodesFromCodeSystem } from './valueset-concept-utils.js';
import type { FhirVersion } from './valueset-package-utils.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';

export interface ValueSetConceptFilter {
    system: string;
    property: string;
    op: string;
    value: string;
    version?: string;
}

interface ValueSetExpansionResolver {
    loadValueSetResource(valueSetUrl: string, fhirVersion?: FhirVersion): Promise<ValueSet | null>;
    loadCodeSystem(
        systemUrl: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<CodeSystem | null>;
}

interface ValueSetExpansionEntry {
    system?: string;
    code?: string;
    contains?: ValueSetExpansionEntry[];
}

const MAX_COMPOSITION_DEPTH = 20;

export async function collectCodesFromValueSet(
    valueSet: ValueSet,
    resolver: ValueSetExpansionResolver,
    visited: Set<string>,
    depth: number,
    preferredFhirMajor?: string,
): Promise<string[]> {
    if (depth >= MAX_COMPOSITION_DEPTH) {
        logger.warn('[ValueSetPackageLoader] Composition depth limit reached', {
            ...terminologyTargetMetadata(valueSet.url),
            maxDepth: MAX_COMPOSITION_DEPTH,
        });
        return [];
    }
    if (valueSet.url && visited.has(valueSet.url)) {
        logger.warn(
            '[ValueSetPackageLoader] Composition cycle detected',
            terminologyTargetMetadata(valueSet.url),
        );
        return [];
    }
    if (valueSet.url) visited.add(valueSet.url);

    const accumulator = new Set<string>();
    flattenExpansion(valueSet.expansion?.contains).forEach(code => accumulator.add(code));

    for (const include of valueSet.compose?.include ?? []) {
        const included = await resolveIncludeOrExclude(include, resolver, new Set(visited), depth, preferredFhirMajor);
        included.forEach(code => accumulator.add(code));
    }

    for (const exclude of valueSet.compose?.exclude ?? []) {
        const excluded = await resolveIncludeOrExclude(exclude, resolver, new Set(visited), depth, preferredFhirMajor);
        excluded.forEach(code => accumulator.delete(code));
    }

    return Array.from(accumulator);
}

export async function collectIncludeConceptFilters(
    valueSet: ValueSet,
    resolver: ValueSetExpansionResolver,
    visited: Set<string>,
    depth: number,
    preferredFhirMajor?: string,
): Promise<ValueSetConceptFilter[]> {
    if (depth >= MAX_COMPOSITION_DEPTH) return [];
    if (valueSet.url && visited.has(valueSet.url)) return [];
    if (valueSet.url) visited.add(valueSet.url);

    const filters: ValueSetConceptFilter[] = [];
    for (const include of valueSet.compose?.include ?? []) {
        if (include.system && Array.isArray(include.filter)) {
            include.filter.forEach(filter => {
                filters.push({
                    system: include.system!,
                    version: include.version,
                    property: filter.property,
                    op: filter.op,
                    value: filter.value,
                });
            });
        }

        for (const nestedUrl of include.valueSet ?? []) {
            const nested = await resolver.loadValueSetResource(nestedUrl, fhirVersionForMajor(preferredFhirMajor));
            if (nested) {
                filters.push(
                    ...await collectIncludeConceptFilters(
                        nested,
                        resolver,
                        visited,
                        depth + 1,
                        preferredFhirMajor,
                    ),
                );
            }
        }
    }

    return filters;
}

/**
 * Systems included whole-system (or via filter) whose CodeSystem cannot be
 * enumerated locally. Codes from such a system may be valid even when the
 * local expansion misses them, so a membership miss is not authoritative.
 * A ValueSet shipping its own expansion is trusted as-is and reports none.
 */
export async function collectUnenumerableSystemIncludes(
    valueSet: ValueSet,
    resolver: ValueSetExpansionResolver,
    visited: Set<string>,
    depth: number,
    preferredFhirMajor?: string,
): Promise<string[]> {
    if (depth >= MAX_COMPOSITION_DEPTH) return [];
    if (valueSet.url && visited.has(valueSet.url)) return [];
    if (valueSet.url) visited.add(valueSet.url);
    if (valueSet.expansion?.contains?.length) return [];

    const systems = new Set<string>();
    for (const include of valueSet.compose?.include ?? []) {
        const [system, pipedSystemVersion] = (include.system ?? '').split('|');
        if (system && !include.concept?.length) {
            const codeSystem = await resolver.loadCodeSystem(
                system,
                preferredFhirMajor,
                include.version ?? pipedSystemVersion,
            );
            if (!isEnumerableCodeSystem(codeSystem)) systems.add(system);
        }
        for (const nestedUrl of include.valueSet ?? []) {
            const nested = await resolver.loadValueSetResource(nestedUrl, fhirVersionForMajor(preferredFhirMajor));
            if (!nested) continue;
            const nestedSystems = await collectUnenumerableSystemIncludes(
                nested,
                resolver,
                visited,
                depth + 1,
                preferredFhirMajor,
            );
            nestedSystems.forEach(nestedSystem => systems.add(nestedSystem));
        }
    }
    return Array.from(systems);
}

function isEnumerableCodeSystem(codeSystem: CodeSystem | null): boolean {
    if (!codeSystem) return false;
    // Non-complete content (fragment/example/not-present/supplement) means the
    // local concept list provably understates the system.
    if (codeSystem.content && codeSystem.content !== 'complete') return false;
    return extractCodesFromCodeSystem(codeSystem).length > 0;
}

function flattenExpansion(contains: NonNullable<ValueSet['expansion']>['contains'] | undefined): string[] {
    const codes: string[] = [];
    const visit = (entries: ValueSetExpansionEntry[]): void => {
        for (const entry of entries) {
            if (entry.code) {
                if (entry.system) codes.push(`${entry.system}|${entry.code}`);
                codes.push(entry.code);
            }
            if (entry.contains?.length) visit(entry.contains);
        }
    };

    if (contains) visit(contains as ValueSetExpansionEntry[]);
    return codes;
}

async function resolveIncludeOrExclude(
    entry: ValueSetComposeInclude | ValueSetComposeExclude,
    resolver: ValueSetExpansionResolver,
    visited: Set<string>,
    depth: number,
    preferredFhirMajor?: string,
): Promise<string[]> {
    const constraints: Set<string>[] = [];
    // Some IGs embed a version in the include's system ("http://...|4.0.1").
    // Codings never carry that pipe, so expansion keys must use the bare
    // canonical; the piped version only steers CodeSystem selection.
    const [system, pipedSystemVersion] = (entry.system ?? '').split('|');
    const requestedVersion = entry.version ?? pipedSystemVersion;

    if (entry.concept?.length) {
        constraints.push(new Set(entry.concept.filter(concept => concept.code)
            .map(concept => system ? `${system}|${concept.code}` : concept.code)));
    }

    for (const vsUrl of entry.valueSet ?? []) {
        const nested = await resolver.loadValueSetResource(vsUrl, fhirVersionForMajor(preferredFhirMajor));
        if (nested) {
            const nestedCodes = await collectCodesFromValueSet(
                nested,
                resolver,
                new Set(visited),
                depth + 1,
                preferredFhirMajor,
            );
            constraints.push(membershipKeys(nestedCodes));
        } else constraints.push(new Set());
    }

    const hasConcepts = Boolean(entry.concept?.length);
    const hasFilters = 'filter' in entry && Array.isArray(entry.filter) && entry.filter.length > 0;
    const hasValueSets = Boolean(entry.valueSet?.length);

    if (system && !hasConcepts && !hasFilters && !hasValueSets) {
        const codeSystem = await resolver.loadCodeSystem(system, preferredFhirMajor, requestedVersion);
        if (codeSystem) {
            constraints.push(new Set(extractCodesFromCodeSystem(codeSystem).map(code => `${system}|${code}`)));
        } else {
            logger.warn(
                '[ValueSetPackageLoader] CodeSystem not found',
                terminologyTargetMetadata(system),
            );
        }
    }

    if (system && hasFilters) {
        const codeSystem = await resolver.loadCodeSystem(system, preferredFhirMajor, requestedVersion);
        if (codeSystem) {
            for (const filter of (entry as ValueSetComposeInclude).filter ?? []) {
                constraints.push(new Set(applyConceptFilter(codeSystem, filter).map(code => `${system}|${code}`)));
            }
        } else constraints.push(new Set());
    }

    // Criteria inside one compose clause intersect; separate include clauses unite.
    const intersection = new Set(constraints[0] ?? []);
    for (const candidate of intersection) {
        if ((system && !candidate.startsWith(`${system}|`))
            || constraints.some(constraint => !constraint.has(candidate))) intersection.delete(candidate);
    }
    return Array.from(new Set([...intersection].flatMap(code => code.includes('|')
        ? [code, code.slice(code.lastIndexOf('|') + 1)] : [code])));
}

function membershipKeys(codes: string[]): Set<string> {
    const qualified = codes.filter(code => code.includes('|'));
    return new Set(qualified.length ? qualified : codes);
}

function fhirVersionForMajor(preferredFhirMajor?: string): FhirVersion | undefined {
    if (preferredFhirMajor === '4') return 'R4';
    if (preferredFhirMajor === '5') return 'R5';
    if (preferredFhirMajor === '6') return 'R6';
    return undefined;
}
