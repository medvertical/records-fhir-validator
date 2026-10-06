/**
 * Validates contained resources, local references, and dom-2/dom-3 rules.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import { unresolvedInternalSystemIssues } from './internal-system-target-rule.js';
import { assertFhirObjectTraversalCapacity } from '../utils/object-traversal-limit.js';

type FhirRecord = Record<string, unknown>;

interface InternalReferenceHit {
    id: string;
    path: string;
}

interface ContainedAnalysis {
    resourceType: string;
    contained: unknown[];
    containedMap: Map<string, FhirRecord>;
    containedIndexes: Map<string, number>;
    duplicateIndexes: Set<number>;
    references: InternalReferenceHit[];
    canonicalReferences: InternalReferenceHit[];
    referencedIds: Set<string>;
}

export interface ContainedValidationResult {
    issues: ValidationIssue[];
    containedMap: Map<string, FhirRecord>;
    referencedIds: Set<string>;
    unreferencedIds: Set<string>;
}

export class ContainedResourceValidator {
    validate(resource: unknown): ValidationIssue[] {
        const analysis = analyzeContainedResources(resource);
        const internalSystems = unresolvedInternalSystemIssues(resource);
        if (analysis.contained.length === 0) return [...validateInternalCanonicals(analysis), ...internalSystems];

        logger.debug(
            `[ContainedValidator] Validating ${analysis.contained.length} contained resources`,
        );

        return [
            ...validateContainedDefinitions(analysis),
            ...validateInternalReferences(analysis),
            ...validateInternalCanonicals(analysis),
            ...internalSystems,
            ...validateContainedUsage(analysis),
        ];
    }

    resolveReference(resource: unknown, reference: string): FhirRecord | null {
        if (!reference.startsWith('#') || reference.length === 1) return null;
        return analyzeContainedResources(resource).containedMap.get(reference.slice(1)) ?? null;
    }

    validateWithMetadata(resource: unknown): ContainedValidationResult {
        const analysis = analyzeContainedResources(resource);
        const unreferencedIds = new Set<string>();
        for (const id of analysis.containedMap.keys()) {
            if (!analysis.referencedIds.has(id)) {
                unreferencedIds.add(id);
            }
        }

        return {
            issues: analysis.contained.length > 0
                ? [
                    ...validateContainedDefinitions(analysis),
                    ...validateInternalReferences(analysis),
                    ...validateInternalCanonicals(analysis),
                    ...validateContainedUsage(analysis),
                ]
                : validateInternalCanonicals(analysis),
            containedMap: analysis.containedMap,
            referencedIds: analysis.referencedIds,
            unreferencedIds,
        };
    }
}

function analyzeContainedResources(resource: unknown): ContainedAnalysis {
    const root = toRecord(resource);
    const resourceType = getNonEmptyString(root?.resourceType) ?? 'Unknown';
    const contained = Array.isArray(root?.contained) ? root.contained : [];
    const containedMap = new Map<string, FhirRecord>();
    const containedIndexes = new Map<string, number>();
    const duplicateIndexes = new Set<number>();

    for (let index = 0; index < contained.length; index++) {
        const candidate = toRecord(contained[index]);
        const id = getNonEmptyString(candidate?.id);
        if (!candidate || !id) continue;
        if (containedMap.has(id)) {
            duplicateIndexes.add(index);
            continue;
        }
        containedMap.set(id, candidate);
        containedIndexes.set(id, index);
    }

    const references: InternalReferenceHit[] = [];
    const canonicalReferences: InternalReferenceHit[] = [];
    const referencedIds = new Set<string>();
    if (root) {
        collectInternalReferences(root, resourceType, undefined, true, references, referencedIds, canonicalReferences);
        for (let index = 0; index < contained.length; index++) {
            const candidate = toRecord(contained[index]);
            if (!candidate) continue;
            collectInternalReferences(
                candidate,
                `${resourceType}.contained[${index}]`,
                getNonEmptyString(candidate.id),
                false,
                references,
                referencedIds,
                canonicalReferences,
            );
        }
    }

    return {
        resourceType,
        contained,
        containedMap,
        containedIndexes,
        duplicateIndexes,
        references,
        canonicalReferences,
        referencedIds,
    };
}

function validateContainedDefinitions(analysis: ContainedAnalysis): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (let index = 0; index < analysis.contained.length; index++) {
        const contained = toRecord(analysis.contained[index]);
        const path = `${analysis.resourceType}.contained[${index}]`;
        const id = getNonEmptyString(contained?.id);

        if (!id) {
            issues.push(createValidationIssue({
                code: 'contained-missing-id',
                path: `${path}.id`,
                resourceType: analysis.resourceType,
                customMessage: 'Contained resource must have an id',
                severityOverride: 'error',
            }));
        } else if (analysis.duplicateIndexes.has(index)) {
            issues.push(createValidationIssue({
                code: 'contained-duplicate-id',
                path: `${path}.id`,
                resourceType: analysis.resourceType,
                customMessage: `Duplicate contained resource id: '${id}'`,
                severityOverride: 'error',
            }));
        }

        if (!getNonEmptyString(contained?.resourceType)) {
            issues.push(createValidationIssue({
                code: 'contained-missing-resourcetype',
                path: `${path}.resourceType`,
                resourceType: analysis.resourceType,
                customMessage: 'Contained resource must have a resourceType',
                severityOverride: 'error',
            }));
        }

        if (Array.isArray(contained?.contained) && contained.contained.length > 0) {
            issues.push(createValidationIssue({
                code: 'contained-nested-violation',
                path: `${path}.contained`,
                resourceType: analysis.resourceType,
                customMessage: 'Contained resources cannot contain other resources (dom-2)',
                severityOverride: 'error',
            }));
        }
    }

    return issues;
}

function validateInternalReferences(analysis: ContainedAnalysis): ValidationIssue[] {
    return analysis.references.flatMap(({ id, path }) => {
        if (analysis.containedMap.has(id)) return [];
        return [createValidationIssue({
            code: 'contained-unresolved-reference',
            path,
            resourceType: analysis.resourceType,
            customMessage: `Reference '#${id}' does not resolve to a contained resource`,
            severityOverride: 'error',
            details: {
                reference: `#${id}`,
                availableIds: Array.from(analysis.containedMap.keys()),
            },
        })];
    });
}

function validateInternalCanonicals(analysis: ContainedAnalysis): ValidationIssue[] {
    return analysis.canonicalReferences.flatMap(({ id, path }) => analysis.containedMap.has(id) ? [] : [
        createValidationIssue({
            code: 'contained-unresolved-canonical',
            path,
            resourceType: analysis.resourceType,
            customMessage: `The URL value '#${id}' is invalid because there is no matching target`,
            severityOverride: 'error',
            details: { reference: `#${id}`, availableIds: Array.from(analysis.containedMap.keys()) },
        }),
    ]);
}

/**
 * Elements whose type is canonical wherever the name occurs, where `#id`
 * must name a contained resource. Raw JSON does not carry the primitive
 * type, and other strings may start with `#` (a markdown heading).
 */
const CANONICAL_ELEMENT_NAMES = new Set(['answerValueSet', 'library', 'valueSet']);

function isCanonicalElementName(key: string): boolean {
    return (key.length > 'Canonical'.length && key.endsWith('Canonical')) || CANONICAL_ELEMENT_NAMES.has(key);
}

function validateContainedUsage(analysis: ContainedAnalysis): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const [id, index] of analysis.containedIndexes) {
        if (analysis.referencedIds.has(id)) continue;
        issues.push(createValidationIssue({
            code: 'contained-unreferenced',
            path: `${analysis.resourceType}.contained[${index}]`,
            resourceType: analysis.resourceType,
            customMessage: `Contained resource '${id}' is not referenced`,
            severityOverride: 'warning',
        }));
    }
    return issues;
}

function collectInternalReferences(
    start: FhirRecord,
    startPath: string,
    ownerId: string | undefined,
    skipRootContained: boolean,
    hits: InternalReferenceHit[],
    referencedIds: Set<string>,
    canonicalHits: InternalReferenceHit[],
): void {
    const pending: Array<{ value: unknown; path: string; isRoot: boolean }> = [
        { value: start, path: startPath, isRoot: true },
    ];
    const visited = new WeakSet<object>();
    let processed = 0;

    while (pending.length > 0) {
        const current = pending.pop();
        if (!current || !current.value || typeof current.value !== 'object') continue;
        if (visited.has(current.value)) continue;
        assertFhirObjectTraversalCapacity(processed, 'contained-resource');
        visited.add(current.value);
        processed++;

        if (Array.isArray(current.value)) {
            for (let index = current.value.length - 1; index >= 0; index--) {
                pending.push({
                    value: current.value[index],
                    path: `${current.path}[${index}]`,
                    isRoot: false,
                });
            }
            continue;
        }

        const record = current.value as FhirRecord;
        // A resource inside this one (a Bundle entry, a Parameters value)
        // resolves `#id` against its own contained list and is validated on its own.
        if (!current.isRoot && typeof record.resourceType === 'string') continue;
        for (const [key, value] of Object.entries(record)) {
            if (current.isRoot && skipRootContained && key === 'contained') continue;
            const path = `${current.path}.${key}`;
            if (typeof value === 'string' && value.startsWith('#') && value.length > 1) {
                // dom-3 counts fragment values carried by Reference, canonical,
                // uri, and url primitives. Raw FHIR JSON does not retain the
                // primitive type here, so mirror the structural check and only
                // use the fragment as positive usage evidence.
                referencedIds.add(value.slice(1));
            }
            if (isCanonicalElementName(key)) {
                const values = Array.isArray(value) ? value : [value];
                values.forEach((item, index) => {
                    if (typeof item === 'string' && item.startsWith('#') && item.length > 1) {
                        canonicalHits.push({ id: item.slice(1), path: Array.isArray(value) ? `${path}[${index}]` : path });
                    }
                });
            }
            if (key === 'reference' && typeof value === 'string' && value.startsWith('#')) {
                const id = value.slice(1);
                if (id.length > 0) {
                    hits.push({ id, path });
                } else if (ownerId) {
                    referencedIds.add(ownerId);
                }
                continue;
            }
            pending.push({ value, path, isRoot: false });
        }
    }
}

function toRecord(value: unknown): FhirRecord | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as FhirRecord
        : undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const containedResourceValidator = new ContainedResourceValidator();
