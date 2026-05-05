/* eslint-disable max-lines -- Bundle validation is inherently broad (type-specific, reference, fullUrl, id-consistency checks); splitting would scatter cohesive logic */
/**
 * Bundle Validator
 *
 * Validates FHIR Bundle resources for structural integrity:
 * - Bundle type validation
 * - Entry structure validation
 * - fullUrl uniqueness
 * - Transaction/batch request requirements
 * - Internal reference resolution
 * - fullUrl-based reference consistency (FHIR R4 §2.1.0.5.2)
 * - fullUrl ↔ resource.id consistency
 *
 * Wraps BundleReferenceResolver for integration into the main validation flow.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { getBundleReferenceResolver } from '../reference';
import { logger } from '../logger';

// ============================================================================
// Helpers
// ============================================================================

const RESOURCE_TYPE_PATTERN = /^[A-Z][A-Za-z]+$/;

/**
 * Extract the resource types implied by a searchset Bundle's `link[self].url`.
 * The expected type can appear either as the last path segment before `?`
 * (`base/Patient?name=test`) or as a comma-separated `_type` query parameter
 * (`base?_type=Observation,DocumentReference`). When neither is present, the
 * search is unconstrained and Records can't infer the expected types — the
 * caller treats an empty result as "skip the type-mismatch check."
 */
function parseSearchSelfLinkTypes(url: string): string[] {
    if (!url) return [];
    const queryIdx = url.indexOf('?');
    const path = queryIdx >= 0 ? url.slice(0, queryIdx) : url;
    const query = queryIdx >= 0 ? url.slice(queryIdx + 1) : '';

    const types: string[] = [];

    // Path segment: …/Type? — the trailing /Type segment is the type filter.
    const pathSegments = path.split('/').filter(Boolean);
    const last = pathSegments[pathSegments.length - 1];
    if (last && RESOURCE_TYPE_PATTERN.test(last)) {
        types.push(last);
    }

    // _type query parameter (comma-separated).
    for (const part of query.split('&')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const key = part.slice(0, eq);
        if (key !== '_type') continue;
        const value = decodeURIComponent(part.slice(eq + 1));
        for (const t of value.split(',')) {
            const trimmed = t.trim();
            if (RESOURCE_TYPE_PATTERN.test(trimmed) && !types.includes(trimmed)) {
                types.push(trimmed);
            }
        }
    }

    return types;
}

// ============================================================================
// Bundle Validator
// ============================================================================

export type EntryResourceValidator = (
    resource: Record<string, unknown>,
    entryIndex: number,
) => Promise<ValidationIssue[]>;

export class BundleValidator {
    private bundleResolver = getBundleReferenceResolver();

    /**
     * Validate a Bundle resource.
     * If entryValidator is provided, each entry.resource is also validated
     * as a standalone resource (structural, profile, terminology etc.).
     */
    async validateBundle(
        resource: any,
        entryValidator?: EntryResourceValidator,
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (resource?.resourceType !== 'Bundle') {
            return issues; // Not a Bundle, skip
        }

        logger.debug('[BundleValidator] Validating Bundle structure and references');

        try {
            // 1. Validate Bundle structure
            const structureIssues = this.bundleResolver.validateBundleStructure(resource);
            for (const issue of structureIssues) {
                issues.push(createValidationIssue({
                    code: issue.code,
                    path: 'Bundle',
                    resourceType: 'Bundle',
                    customMessage: issue.message,
                    severityOverride: issue.severity,
                }));
            }

            // 2. Validate internal references (uses optimized index-based lookup)
            const refResult = this.bundleResolver.validateBundleReferencesOptimized(resource);
            for (const issue of refResult.issues) {
                const path = issue.entryIndex !== undefined
                    ? `Bundle.entry[${issue.entryIndex}]`
                    : 'Bundle';

                issues.push(createValidationIssue({
                    code: issue.code,
                    path,
                    resourceType: 'Bundle',
                    customMessage: issue.message,
                    severityOverride: issue.severity,
                    details: issue.reference ? { reference: issue.reference } : undefined,
                }));
            }

            // 3. Additional validations for specific Bundle types
            const bundleType = this.bundleResolver.getBundleType(resource);
            if (bundleType) {
                issues.push(...this.validateBundleTypeSpecific(resource, bundleType));
            }

            // Detect duplicate Bundle.entry.id values up front. Java's
            // reference validator switches to strict reference resolution
            // when these are present (mni-patientOverview-bundle-example1b
            // is the canonical case): relative-fullUrl entries that would
            // otherwise resolve via lenient type+id fallback are treated as
            // unresolvable, and reachability runs against relative fullUrls
            // instead of skipping them.
            const strictRefs = this.bundleHasDuplicateEntryIds(resource);

            // 3b. For document/message bundles: every entry should be
            //     reachable from the Composition / MessageHeader by walking
            //     references forwards or backwards. Java emits these as
            //     `error/informational` per orphan entry.
            if (bundleType === 'document' || bundleType === 'message') {
                issues.push(...this.validateBundleReachability(resource, bundleType, strictRefs));
            }

            // 4. Cross-entry referential integrity (K-3)
            issues.push(...this.validateCrossEntryReferences(resource, bundleType, strictRefs));

            // 5. Entry duplication detection (by resourceType/id)
            issues.push(...this.detectDuplicateEntries(resource));

            // 6. fullUrl presence check (FHIR R4: fullUrl is mandatory in
            //    document/message/transaction/batch bundles)
            issues.push(...this.validateFullUrlPresence(resource, bundleType));

            // 7. fullUrl format + uniqueness (FHIR spec: Bundle.entry.fullUrl must
            //    be an absolute URL and unique across the Bundle)
            issues.push(...this.validateFullUrls(resource, bundleType));

            // 8. fullUrl ↔ resource.id consistency (FHIR R4: when fullUrl
            //    looks like a RESTful URL, its trailing ResourceType/id must
            //    match the resource)
            issues.push(...this.validateEntryIdConsistency(resource));

            // 9. Duplicate link relation types
            issues.push(...this.validateLinkRelations(resource));

            // 9. Validate each entry.resource as a standalone resource
            if (entryValidator) {
                const entries = resource.entry || [];
                for (let i = 0; i < entries.length; i++) {
                    const entryRes = entries[i]?.resource;
                    if (!entryRes?.resourceType) continue;
                    try {
                        const entryIssues = await entryValidator(entryRes, i);
                        for (const issue of entryIssues) {
                            issues.push({
                                ...issue,
                                path: issue.path
                                    ? `Bundle.entry[${i}].resource.${issue.path}`
                                    : `Bundle.entry[${i}].resource`,
                            });
                        }
                    } catch (err) {
                        logger.warn(`[BundleValidator] Entry[${i}] validation failed: ${err}`);
                    }
                }
            }

            logger.debug(`[BundleValidator] Found ${issues.length} issues in Bundle`);

        } catch (error) {
            logger.error('[BundleValidator] Error validating Bundle:', error);
            issues.push(createValidationIssue({
                code: 'bundle-validation-error',
                path: 'Bundle',
                resourceType: 'Bundle',
                customMessage: `Bundle validation failed: ${error instanceof Error ? error.message : String(error)}`,
            }));
        }

        return issues;
    }

    /**
     * Type-specific Bundle validations
     */
    private validateBundleTypeSpecific(bundle: any, bundleType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries = bundle.entry || [];

        switch (bundleType) {
            case 'document':
                // bdl-9: Document Bundles SHALL have an identifier with
                // both system and value.
                if (!this.hasDocumentIdentifier(bundle)) {
                    issues.push(createValidationIssue({
                        code: 'bdl-9-violation',
                        path: 'Bundle.identifier',
                        resourceType: 'Bundle',
                        customMessage: 'bdl-9: Document Bundle SHALL have an identifier with both system and value',
                        severityOverride: 'error',
                    }));
                }

                // bdl-10: Document Bundles SHALL have a timestamp.
                if (typeof bundle.timestamp !== 'string' || bundle.timestamp.length === 0) {
                    issues.push(createValidationIssue({
                        code: 'bdl-10-violation',
                        path: 'Bundle.timestamp',
                        resourceType: 'Bundle',
                        customMessage: 'bdl-10: Document Bundle SHALL have a timestamp',
                        severityOverride: 'error',
                    }));
                }

                // Document Bundles SHALL have a Composition as first entry
                // (bdl-11 / "Document bundle rule" in R4 Bundle SD). This is
                // a normative SHALL and must be an error, not a warning —
                // any document-processing pipeline crashes or produces
                // wrong output otherwise.
                if (entries[0]?.resource?.resourceType !== 'Composition') {
                    const actual = entries[0]?.resource?.resourceType || '(no resource)';
                    issues.push(createValidationIssue({
                        code: 'bundle-document-first-entry-not-composition',
                        path: 'Bundle.entry[0].resource',
                        resourceType: 'Bundle',
                        customMessage:
                            `Document Bundle SHALL have a Composition as the first entry ` +
                            `(R4 bdl-11). Found ${actual} instead.`,
                        severityOverride: 'error',
                    }));
                }
                break;

            case 'message':
                // Message Bundles SHALL have a MessageHeader as first entry
                // (bdl-12 / "Message bundle rule"). Same normative SHALL
                // reasoning as the document case above.
                if (entries[0]?.resource?.resourceType !== 'MessageHeader') {
                    const actual = entries[0]?.resource?.resourceType || '(no resource)';
                    issues.push(createValidationIssue({
                        code: 'bundle-message-first-entry-not-messageheader',
                        path: 'Bundle.entry[0].resource',
                        resourceType: 'Bundle',
                        customMessage:
                            `Message Bundle SHALL have a MessageHeader as the first entry ` +
                            `(R4 bdl-12). Found ${actual} instead.`,
                        severityOverride: 'error',
                    }));
                }
                break;

            case 'searchset':
                issues.push(...this.validateSearchsetBundle(bundle, entries));
                break;

            case 'history':
                // History Bundles should have total
                if (bundle.total === undefined) {
                    issues.push(createValidationIssue({
                        code: 'bundle-history-missing-total',
                        path: 'Bundle',
                        resourceType: 'Bundle',
                        customMessage: 'History Bundle should have total element',
                        severityOverride: 'warning',
                    }));
                }
                break;
        }

        return issues;
    }

    private hasDocumentIdentifier(bundle: any): boolean {
        return typeof bundle?.identifier?.system === 'string' &&
            bundle.identifier.system.length > 0 &&
            typeof bundle?.identifier?.value === 'string' &&
            bundle.identifier.value.length > 0;
    }

    /**
     * Searchset-specific Bundle rules. Java's reference validator emits four
     * families of issues here; the most subtle one is the
     * "self link → search modes" pairing — Java only complains about missing
     * `entry.search.mode` when the bundle also lacks a self link. A bundle
     * that *does* declare its self link is treated as having opted into
     * search semantics deliberately, so the missing-mode warning is dropped
     * (see bundle-profiles vs bundle-id-1 baselines).
     */
    private validateSearchsetBundle(bundle: any, entries: any[]): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (bundle.total === undefined) {
            issues.push(createValidationIssue({
                code: 'bundle-searchset-missing-total',
                path: 'Bundle',
                resourceType: 'Bundle',
                customMessage: 'Searchset Bundle should have total element',
                severityOverride: 'warning',
            }));
        }

        const links: any[] = Array.isArray(bundle.link) ? bundle.link : [];
        const selfLink = links.find(l => l?.relation === 'self');
        if (!selfLink) {
            issues.push(createValidationIssue({
                code: 'bundle-searchset-missing-self-link',
                path: 'Bundle',
                resourceType: 'Bundle',
                customMessage: 'SearchSet Bundles should have a self link that specifies what the search was',
                severityOverride: 'warning',
            }));

            if (entries.some((e: any) => !e?.search?.mode)) {
                issues.push(createValidationIssue({
                    code: 'bundle-searchset-missing-search-mode',
                    path: 'Bundle',
                    resourceType: 'Bundle',
                    customMessage: 'SearchSet bundles should have search modes on the entries',
                    severityOverride: 'warning',
                }));
            }
        }

        // The self link's URL implies which resource types the searchset was
        // meant to return — either as a `[base/]ResourceType?…` path segment
        // or as `?_type=Type1,Type2`. Records mirrors Java's behaviour and
        // flags entries whose resource type is not in that set (excluding
        // OperationOutcome entries, which represent the search outcome).
        const expectedTypes = parseSearchSelfLinkTypes(typeof selfLink?.url === 'string' ? selfLink.url : '');

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const mode = entry?.search?.mode;
            const res = entry?.resource;
            if (!res) continue;

            if ((mode === 'match' || mode === 'include') && !res.id) {
                issues.push(createValidationIssue({
                    code: 'bundle-searchset-entry-missing-id',
                    path: `Bundle.entry[${i}].resource`,
                    resourceType: 'Bundle',
                    customMessage: 'Search results must have ids',
                    severityOverride: 'error',
                }));
            }

            if (mode === 'outcome' && res.resourceType && res.resourceType !== 'OperationOutcome') {
                issues.push(createValidationIssue({
                    code: 'bundle-searchset-outcome-wrong-type',
                    path: `Bundle.entry[${i}].resource`,
                    resourceType: 'Bundle',
                    customMessage: `This is not an OperationOutcome (${res.resourceType})`,
                    severityOverride: 'error',
                }));
            }

            if (
                expectedTypes.length > 0 &&
                res.resourceType &&
                mode !== 'outcome' &&
                !expectedTypes.includes(res.resourceType)
            ) {
                issues.push(createValidationIssue({
                    code: 'bundle-searchset-entry-wrong-type',
                    path: `Bundle.entry[${i}].resource`,
                    resourceType: 'Bundle',
                    customMessage:
                        `This is not a matching resource type for the specified search ` +
                        `(${res.resourceType} expecting [${expectedTypes.join(', ')}])`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

    /**
     * Document / message bundles must form a connected reference graph rooted
     * at the first entry (Composition for documents, MessageHeader for
     * messages). Java emits an `error/informational` per entry that isn't
     * reachable by walking references forwards or backwards from the root —
     * see the bundle-urn baseline ("Entry 'urn:uuid:...' isn't reachable by
     * traversing links (forward or backward) from the Composition").
     *
     * Resolution mirrors validateCrossEntryReferences: relative `Type/id`
     * refs are composed against the source entry's fullUrl base; urn: refs
     * match fullUrl directly. References that don't resolve to an entry are
     * silently skipped here — validateCrossEntryReferences already flags
     * them.
     */
    private validateBundleReachability(
        bundle: any,
        bundleType: string,
        strictRefs = false,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries: any[] = bundle?.entry ?? [];
        if (entries.length <= 1) return issues;

        // Skip reachability when any entry's fullUrl is missing or not a
        // well-formed urn:/http(s) URL. Those bundles are already flagged
        // by validateFullUrls / validateFullUrlPresence and the relative-
        // ref resolution that reachability needs would be unreliable —
        // mni-patientOverview-example1 with its `Composition/1`-style
        // fullUrls is the canonical regression case. The strictRefs flag
        // (set when the bundle carries duplicate entry.ids) overrides this
        // skip so the reachability errors mirror Java's strict-mode output.
        const isWellFormedFullUrl = (u: unknown): boolean =>
            typeof u === 'string' && (u.startsWith('urn:') || /^https?:\/\//.test(u));
        if (!strictRefs) {
            for (const e of entries) {
                if (!isWellFormedFullUrl(e?.fullUrl)) return issues;
            }
        }

        const fullUrlIndex = new Map<string, number[]>();
        const versionedFullUrlIndex = new Map<string, number[]>();
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (typeof e?.fullUrl === 'string') {
                const indexes = fullUrlIndex.get(e.fullUrl) || [];
                indexes.push(i);
                fullUrlIndex.set(e.fullUrl, indexes);

                const versionId = e?.resource?.meta?.versionId;
                if (versionId) {
                    const versionedIndexes = versionedFullUrlIndex.get(`${e.fullUrl}/_history/${versionId}`) || [];
                    versionedIndexes.push(i);
                    versionedFullUrlIndex.set(`${e.fullUrl}/_history/${versionId}`, versionedIndexes);
                }
            }
        }

        const forward = this.buildBundleForwardGraph(entries, fullUrlIndex, versionedFullUrlIndex);
        const reachable = this.bfsBundleGraph(entries.length, forward);

        const rootResourceLabel = bundleType === 'document' ? 'Composition' : 'MessageHeader';
        for (let i = 1; i < entries.length; i++) {
            if (reachable.has(i)) continue;
            const fullUrl = entries[i]?.fullUrl;
            const res = entries[i]?.resource;
            const label = fullUrl
                ? fullUrl
                : (res?.resourceType && res?.id ? `${res.resourceType}/${res.id}` : `entry[${i}]`);
            issues.push(createValidationIssue({
                code: 'bundle-entry-not-reachable',
                path: `Bundle.entry[${i}]`,
                resourceType: 'Bundle',
                customMessage:
                    `Entry '${label}' isn't reachable by traversing links (forward or backward) from the ${rootResourceLabel}`,
                severityOverride: 'error',
            }));
        }

        return issues;
    }

    /**
     * Resolve a literal Reference to a target entry index using strict
     * fullUrl-based rules (FHIR R4 §2.1.0.5.2). Used by reachability — the
     * cross-entry-reference check has its own resolver that allows looser
     * type+id fallbacks.
     */
    private resolveLiteralRefToEntryIndex(
        ref: string,
        sourceFullUrl: string | undefined,
        fullUrlIndex: Map<string, number[]>,
        versionedFullUrlIndex: Map<string, number[]>,
    ): number | null {
        if (!ref || ref.startsWith('#') || ref.includes('?')) return null;
        const pickSingle = (indexes: number[] | undefined): number | null =>
            indexes && indexes.length === 1 ? indexes[0] : null;
        const refIsVersioned = /\/_history\/[^/]+$/.test(ref);

        if (ref.startsWith('urn:')) {
            return pickSingle(fullUrlIndex.get(ref));
        }
        if (/^https?:\/\//.test(ref)) {
            return refIsVersioned
                ? pickSingle(versionedFullUrlIndex.get(ref))
                : pickSingle(fullUrlIndex.get(ref));
        }
        if (!sourceFullUrl || sourceFullUrl.startsWith('urn:')) return null;
        const m = sourceFullUrl.match(/^(https?:\/\/.+\/)[A-Z][a-zA-Z]+\/[^/]+$/);
        if (!m) return null;
        const target = `${m[1]}${ref}`;
        return refIsVersioned
            ? pickSingle(versionedFullUrlIndex.get(target))
            : pickSingle(fullUrlIndex.get(target));
    }

    private buildBundleForwardGraph(
        entries: any[],
        fullUrlIndex: Map<string, number[]>,
        versionedFullUrlIndex: Map<string, number[]>,
    ): Set<number>[] {
        const forward: Set<number>[] = entries.map(() => new Set<number>());
        for (let i = 0; i < entries.length; i++) {
            const res = entries[i]?.resource;
            if (!res) continue;
            const refs: { reference: string; path: string }[] = [];
            this.extractReferencesWithPaths(res, '', refs);
            for (const { reference } of refs) {
                const target = this.resolveLiteralRefToEntryIndex(
                    reference, entries[i]?.fullUrl, fullUrlIndex, versionedFullUrlIndex,
                );
                if (target !== null && target !== i) forward[i].add(target);
            }
        }
        return forward;
    }

    private bfsBundleGraph(size: number, forward: Set<number>[]): Set<number> {
        const reachable = new Set<number>([0]);
        const queue: number[] = [0];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const next of forward[cur]) {
                if (!reachable.has(next)) {
                    reachable.add(next);
                    queue.push(next);
                }
            }
            for (let j = 0; j < size; j++) {
                if (forward[j].has(cur) && !reachable.has(j)) {
                    reachable.add(j);
                    queue.push(j);
                }
            }
        }
        return reachable;
    }

    // ==========================================================================
    // Cross-Entry Referential Integrity (K-3)
    // ==========================================================================

    /**
     * Validate that references between bundle entries can be resolved
     * within the bundle itself. This is critical for:
     *
     * - **Document bundles**: every reference in the Composition must point
     *   to an entry in the same bundle (FHIR Document rules)
     * - **Transaction/batch bundles**: conditional references
     *   (`ResourceType?identifier=...`) are out of scope; only literal
     *   references (`ResourceType/id`, `urn:uuid:...`, fullUrl) are checked
     *
     * Non-resolvable external references (absolute URLs not matching any
     * fullUrl) are flagged as warnings, not errors, because they may
     * legitimately point at resources on a remote server.
     *
     * **fullUrl-based resolution** (FHIR R4 §2.1.0.5.2): relative references
     * like `Patient/123` resolve by composing the reference against the
     * "base" of the *source entry's* fullUrl. If the source entry's fullUrl
     * is a `urn:uuid:` or `urn:oid:`, there is no REST base, so relative
     * references cannot resolve — the entry must use the urn: scheme instead.
     */
    // eslint-disable-next-line max-lines-per-function -- builds the fullUrl/typeId index, walks every reference, and emits both the closed-bundle "Can't find" error and the non-closed-bundle "Entry N matches by type and id" warning in one pass; splitting would scatter cohesive resolution logic.
    private validateCrossEntryReferences(
        bundle: any,
        bundleType: string | null,
        strictRefs = false,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries: any[] = bundle?.entry ?? [];
        if (entries.length === 0) return issues;

        // Build indexes for reference resolution.
        // fullUrlIndex: fullUrl string → entry index (for urn:uuid: and absolute URL matching)
        const fullUrlIndex = new Set<string>();
        const fullUrlToEntryIndexes = new Map<string, number[]>();
        // typeIdToFullUrls: "ResourceType/id" → list of fullUrls for entries with that type+id
        const typeIdToFullUrls = new Map<string, string[]>();
        // Versioned fullUrl entries for _history resolution
        const versionedIndex = new Set<string>();

        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
            const entry = entries[entryIndex];
            if (entry.fullUrl) {
                fullUrlIndex.add(entry.fullUrl);
                const indexes = fullUrlToEntryIndexes.get(entry.fullUrl) || [];
                indexes.push(entryIndex);
                fullUrlToEntryIndexes.set(entry.fullUrl, indexes);
            }
            const res = entry.resource;
            if (res?.resourceType && res?.id) {
                const rtId = `${res.resourceType}/${res.id}`;
                const urls = typeIdToFullUrls.get(rtId) || [];
                urls.push(entry.fullUrl || '');
                typeIdToFullUrls.set(rtId, urls);
                const versionId = res.meta?.versionId;
                if (versionId) {
                    versionedIndex.add(`${rtId}/_history/${versionId}`);
                    if (entry.fullUrl) {
                        versionedIndex.add(`${entry.fullUrl}/_history/${versionId}`);
                    }
                }
            }
        }

        // For document bundles, the Composition references are mandatory-resolvable
        const isClosedBundle = bundleType === 'document' || bundleType === 'message';

        for (let i = 0; i < entries.length; i++) {
            const res = entries[i]?.resource;
            if (!res) continue;

            const sourceFullUrl: string | undefined = entries[i]?.fullUrl;

            const refsWithPaths: { reference: string; path: string }[] = [];
            this.extractReferencesWithPaths(res, '', refsWithPaths);
            for (const { reference: ref, path: refPath } of refsWithPaths) {
                // Skip contained references — they resolve within the resource
                if (ref.startsWith('#')) continue;
                // Skip conditional references (search-based)
                if (ref.includes('?')) continue;

                // For versioned references strip the `/_history/N` suffix
                const historyMatch = ref.match(/^(.*)\/_history\/[^/]+$/);
                const unversioned = historyMatch ? historyMatch[1] : ref;

                const resolved = this.resolveReferenceInBundle(
                    ref, unversioned, sourceFullUrl,
                    fullUrlIndex, fullUrlToEntryIndexes, typeIdToFullUrls, versionedIndex,
                    strictRefs,
                );

                if (resolved.resolvable) continue;

                // Build an informative message when a type+id match exists
                // but fullUrl rules prevent resolution.
                const detail = resolved.hasTypeIdMatch
                    ? ` Note that there is a resource in the bundle with the same type and id, ` +
                      `but it does not match because of the fullUrl based rules around ` +
                      `matching relative references.`
                    : '';

                const issuePath = (!sourceFullUrl || !refPath)
                    ? `Bundle.entry[${i}].resource`
                    : `Bundle.entry[${i}].resource.${refPath}`;

                if (isClosedBundle) {
                    if (ref.includes('/_history/') && resolved.hasTypeIdMatch) {
                        const matches = this.findEntryFullUrlsByLogicalRef(entries, unversioned);
                        issues.push(createValidationIssue({
                            code: 'required',
                            path: issuePath,
                            resourceType: 'Bundle',
                            customMessage:
                                `The bundle contains no match for ${this.composeFullTarget(ref, sourceFullUrl)} ` +
                                `by the rules of Bundle reference resolution, but it has multiple resources ` +
                                `that match ${ref} by resource type and id`,
                            severityOverride: 'warning',
                        }));

                        const matchCount = Math.max(matches.length, resolved.matchCount || 0);
                        for (let mi = 0; mi < matchCount; mi++) {
                            const matchedFullUrl = matches[mi] || this.composeFullTarget(unversioned, sourceFullUrl);
                            issues.push(createValidationIssue({
                                code: 'required',
                                path: issuePath,
                                resourceType: 'Bundle',
                                customMessage:
                                    `Entry ${mi + 1} matches the reference ${ref} by type and id ` +
                                    `but its fullUrl ${matchedFullUrl} does not match the full target URL ` +
                                    `${this.composeFullTarget(ref, sourceFullUrl)} by Bundle resolution rules`,
                                severityOverride: 'warning',
                            }));
                        }
                    }

                    issues.push(createValidationIssue({
                        code: 'bundle-cross-entry-reference-missing',
                        path: issuePath,
                        resourceType: 'Bundle',
                        customMessage: resolved.multipleMatches
                            ? `Found ${resolved.matchCount} matches for '${ref}' in the bundle`
                            : `Can't find '${ref}' in the bundle ` +
                                `(${res.resourceType ?? 'entry'}[${i}]).${detail}`,
                        severityOverride: 'error',
                    }));
                } else if (resolved.hasTypeIdMatch && sourceFullUrl && !sourceFullUrl.startsWith('urn:')) {
                    // Non-closed bundles + REST-style source fullUrl: when a
                    // type+id match exists but fullUrl resolution rules
                    // shadow it, Java emits a warning per matching entry
                    // ("Entry N matches the reference X by type and id but
                    // its fullUrl Y does not match by Bundle resolution
                    // rules" — see ref-policy-default-r4 baseline). Records
                    // mirrors that here. urn:-source entries are skipped
                    // because R5's reference-resolution policy emits these
                    // as informational; we don't have version routing yet
                    // so we stay conservative on the urn: side.
                    const matches = typeIdToFullUrls.get(unversioned) || [];
                    for (let mi = 0; mi < matches.length; mi++) {
                        const matchedFullUrl = matches[mi] || '(no fullUrl)';
                        const matchedEntryIndex = entries.findIndex(
                            (e: any) => e?.fullUrl === matches[mi],
                        );
                        const entryLabel = matchedEntryIndex >= 0
                            ? matchedEntryIndex + 1
                            : '?';
                        issues.push(createValidationIssue({
                            code: 'bundle-cross-entry-fullurl-mismatch',
                            path: issuePath,
                            resourceType: 'Bundle',
                            customMessage:
                                `Entry ${entryLabel} matches the reference ${ref} by type and id ` +
                                `but its fullUrl ${matchedFullUrl} does not match by Bundle resolution rules`,
                            severityOverride: 'warning',
                        }));
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Resolve a reference within the bundle using FHIR fullUrl-based resolution rules.
     *
     * FHIR R4 §2.1.0.5.2: relative references are resolved against the
     * "base" derived from the *source entry's* fullUrl. When the source
     * entry's fullUrl is a `urn:` URI there is no REST base, so relative
     * references cannot resolve.
     */
    private resolveReferenceInBundle(
        ref: string,
        unversioned: string,
        sourceFullUrl: string | undefined,
        fullUrlIndex: Set<string>,
        fullUrlToEntryIndexes: Map<string, number[]>,
        typeIdToFullUrls: Map<string, string[]>,
        versionedIndex: Set<string>,
        strictRefs = false,
    ): { resolvable: boolean; hasTypeIdMatch: boolean; multipleMatches?: boolean; matchCount?: number } {
        const historyMatch = ref.match(/^(.*)\/_history\/([^/]+)$/);
        const refIsVersioned = historyMatch !== null;

        // 1. urn:uuid / urn:oid references → direct fullUrl match only
        if (ref.startsWith('urn:uuid:') || ref.startsWith('urn:oid:')) {
            return { resolvable: fullUrlIndex.has(ref), hasTypeIdMatch: false };
        }

        // 2. Absolute HTTP(S) references → match fullUrl directly
        if (/^https?:\/\//.test(ref)) {
            const directMatch = refIsVersioned
                ? versionedIndex.has(ref)
                : fullUrlIndex.has(ref) || fullUrlIndex.has(unversioned);
            const matchCount = fullUrlToEntryIndexes.get(ref)?.length
                || fullUrlToEntryIndexes.get(unversioned)?.length
                || 0;
            return {
                resolvable: directMatch && matchCount <= 1,
                hasTypeIdMatch: false,
                multipleMatches: !refIsVersioned && matchCount > 1,
                matchCount,
            };
        }

        // 3. Relative references (ResourceType/id or ResourceType/id/_history/N)
        //    Resolution depends on the source entry's fullUrl.
        const relativeRef = unversioned; // e.g. "Patient/123"
        const hasTypeIdMatchInBundle = typeIdToFullUrls.has(relativeRef);
        const typeIdMatchCount = typeIdToFullUrls.get(relativeRef)?.length || 0;

        // 3a. Source entry has no fullUrl → relative reference resolves by
        //     type+id matching (legacy behavior; separate rule flags the
        //     missing fullUrl)
        if (!sourceFullUrl) {
            const resolvable = refIsVersioned
                ? versionedIndex.has(ref)
                : hasTypeIdMatchInBundle || versionedIndex.has(ref);
            return {
                resolvable: resolvable && (!hasTypeIdMatchInBundle || typeIdMatchCount <= 1 || refIsVersioned),
                hasTypeIdMatch: false,
                multipleMatches: !refIsVersioned && typeIdMatchCount > 1,
                matchCount: typeIdMatchCount,
            };
        }

        // 3b. Source entry's fullUrl is a urn: URI (urn:uuid: or urn:oid:)
        //     → no REST base exists, relative references CANNOT resolve.
        //     The entry must use the urn: scheme instead.
        if (sourceFullUrl.startsWith('urn:')) {
            return { resolvable: false, hasTypeIdMatch: hasTypeIdMatchInBundle };
        }

        // 3c. Source entry's fullUrl is an absolute URL (e.g.
        //     http://example.com/fhir/Patient/1). Derive the base and compose
        //     the target URL.
        const base = this.deriveBaseUrl(sourceFullUrl);
        if (base) {
            const targetUrl = `${base}${refIsVersioned ? ref : relativeRef}`;
            if (refIsVersioned) {
                return {
                    resolvable: versionedIndex.has(targetUrl),
                    hasTypeIdMatch: hasTypeIdMatchInBundle,
                    matchCount: typeIdMatchCount,
                };
            }
            if (fullUrlIndex.has(targetUrl)) {
                const matchCount = fullUrlToEntryIndexes.get(targetUrl)?.length || 0;
                return {
                    resolvable: matchCount <= 1,
                    hasTypeIdMatch: false,
                    multipleMatches: matchCount > 1,
                    matchCount,
                };
            }
            // The composed URL didn't match any entry's fullUrl, but there
            // might be an entry with the same type+id whose fullUrl is
            // different (e.g. urn:uuid:). That's not a valid match.
            return { resolvable: false, hasTypeIdMatch: hasTypeIdMatchInBundle };
        }

        // 3d. Couldn't derive base — fall back to type+id matching, unless
        //     strict-refs mode is on (bundle has duplicate entry.id values).
        //     In that case, lenient fallback would mask the cross-entry-ref
        //     errors Java emits for the same shape; report the type+id match
        //     as a "blocked by fullUrl rules" hit instead.
        if (strictRefs && !refIsVersioned) {
            return { resolvable: false, hasTypeIdMatch: hasTypeIdMatchInBundle, matchCount: typeIdMatchCount };
        }
        const resolvable = refIsVersioned
            ? versionedIndex.has(ref)
            : hasTypeIdMatchInBundle || versionedIndex.has(ref);
        return {
            resolvable: resolvable && (!hasTypeIdMatchInBundle || typeIdMatchCount <= 1 || refIsVersioned),
            hasTypeIdMatch: false,
            multipleMatches: !refIsVersioned && typeIdMatchCount > 1,
            matchCount: typeIdMatchCount,
        };
    }

    private composeFullTarget(ref: string, sourceFullUrl: string | undefined): string {
        if (!sourceFullUrl || sourceFullUrl.startsWith('urn:') || /^https?:\/\//.test(ref)) {
            return ref;
        }
        const base = this.deriveBaseUrl(sourceFullUrl);
        return base ? `${base}${ref}` : ref;
    }

    private findEntryFullUrlsByLogicalRef(entries: any[], logicalRef: string): string[] {
        const [resourceType, id] = logicalRef.split('/');
        if (!resourceType || !id) return [];

        return entries
            .filter((entry: any) =>
                entry?.resource?.resourceType === resourceType &&
                entry?.resource?.id === id)
            .map((entry: any) => entry?.fullUrl || '');
    }

    /**
     * Derive the base URL from a fullUrl for relative reference resolution.
     * E.g. "http://example.com/fhir/Patient/123" → "http://example.com/fhir/"
     *
     * The base is everything up to and including the segment before
     * "ResourceType/id". For a simple URL like "http://example.com/Patient/1"
     * the base is "http://example.com/".
     */
    private deriveBaseUrl(fullUrl: string): string | null {
        if (!fullUrl || fullUrl.startsWith('urn:')) return null;

        // Match pattern: .../<ResourceType>/<id> at the end
        // ResourceType starts with uppercase, id is the last segment
        const match = fullUrl.match(/^(https?:\/\/.+\/)[A-Z][a-zA-Z]+\/[^/]+$/);
        if (match) return match[1];

        // Fallback: just strip last two path segments
        const lastSlash = fullUrl.lastIndexOf('/');
        if (lastSlash <= 0) return null;
        const secondLast = fullUrl.lastIndexOf('/', lastSlash - 1);
        if (secondLast <= 0) return null;
        return fullUrl.substring(0, secondLast + 1);
    }

    // ==========================================================================
    // fullUrl Enforcement
    // ==========================================================================

    /**
     * Validate that Bundle entries have fullUrl.
     *
     * FHIR R4 rules:
     * - document/message bundles: fullUrl is REQUIRED (SHALL) on every entry
     * - transaction/batch bundles: fullUrl is REQUIRED for entries with resources
     * - other bundle types: fullUrl is RECOMMENDED (SHOULD) but not mandatory
     */
    private validateFullUrlPresence(bundle: any, bundleType: string | null): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries: any[] = bundle?.entry ?? [];

        // Types where fullUrl is mandatory (SHALL)
        const mandatoryTypes = new Set(['document', 'message', 'transaction', 'batch']);
        const isMandatory = bundleType !== null && mandatoryTypes.has(bundleType);

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry?.resource) continue; // skip entries without resources

            if (!entry.fullUrl) {
                if (isMandatory) {
                    issues.push(createValidationIssue({
                        code: 'bundle-entry-missing-fullurl',
                        path: `Bundle.entry[${i}]`,
                        resourceType: 'Bundle',
                        customMessage: `Entry[${i}] (${entry.resource?.resourceType ?? 'unknown'}) must have a fullUrl in a ${bundleType} Bundle`,
                        severityOverride: 'error',
                    }));
                } else {
                    issues.push(createValidationIssue({
                        code: 'bundle-entry-missing-fullurl',
                        path: `Bundle.entry[${i}]`,
                        resourceType: 'Bundle',
                        customMessage: `Entry[${i}] (${entry.resource?.resourceType ?? 'unknown'}) should have a fullUrl`,
                        severityOverride: 'warning',
                    }));
                }

                // Java's reference validator emits an additional error per
                // relative reference *inside* a missing-fullUrl entry: the
                // reference can't resolve in the bundle without a base
                // (bundle-ea-testcase MeasureReport.subject is the canonical
                // case). Mirror that diagnosis at each Reference path.
                if (isMandatory) {
                    const refsWithPaths: { reference: string; path: string }[] = [];
                    this.extractReferencesWithPaths(entry.resource, '', refsWithPaths);
                    for (const { reference, path: refPath } of refsWithPaths) {
                        if (!reference || reference.startsWith('#') || reference.startsWith('urn:') || /^https?:\/\//.test(reference) || reference.includes('?')) {
                            continue;
                        }
                        const issuePath = refPath
                            ? `Bundle.entry[${i}].resource.${refPath}`
                            : `Bundle.entry[${i}].resource`;
                        issues.push(createValidationIssue({
                            code: 'bundle-entry-missing-fullurl-relative-ref',
                            path: issuePath,
                            resourceType: 'Bundle',
                            customMessage: `Relative Reference appears inside Bundle whose entry is missing a fullUrl`,
                            severityOverride: 'error',
                        }));
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Recursively extract all reference strings from a FHIR resource together
     * with the FHIRPath that points at the parent Reference object. The
     * parent path (e.g. `subject` or `section[0].entry[1]`) is what Java's
     * cross-entry diagnostics anchor on, not the inner `.reference` leaf.
     */
    private extractReferencesWithPaths(
        obj: unknown,
        currentPath: string,
        refs: { reference: string; path: string }[],
    ): void {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.extractReferencesWithPaths(obj[i], `${currentPath}[${i}]`, refs);
            }
            return;
        }
        const record = obj as Record<string, unknown>;
        if (typeof record.reference === 'string' && record.reference.length > 0) {
            refs.push({ reference: record.reference, path: currentPath });
        }
        for (const key of Object.keys(record)) {
            if (key === 'contained') continue; // Don't descend into contained
            const childPath = currentPath ? `${currentPath}.${key}` : key;
            this.extractReferencesWithPaths(record[key], childPath, refs);
        }
    }

    /**
     * Recursively extract all reference strings from a FHIR resource.
     * Looks for `.reference` properties anywhere in the tree.
     */
    private extractReferences(obj: unknown, refs: string[] = []): string[] {
        if (!obj || typeof obj !== 'object') return refs;
        if (Array.isArray(obj)) {
            for (const item of obj) this.extractReferences(item, refs);
            return refs;
        }
        const record = obj as Record<string, unknown>;
        if (typeof record.reference === 'string' && record.reference.length > 0) {
            refs.push(record.reference);
        }
        for (const key of Object.keys(record)) {
            if (key === 'contained') continue; // Don't descend into contained
            this.extractReferences(record[key], refs);
        }
        return refs;
    }

    /**
     * Validate Bundle.entry.fullUrl format and uniqueness.
     *
     * FHIR spec (http://hl7.org/fhir/R4/bundle.html#bundle-unique-urls):
     * - fullUrl, when present, should be an absolute URI
     * - Each entry's fullUrl must be unique within the Bundle (bdl-7)
     *
     * Java's reference validator enforces the absolute-URL rule for ALL
     * bundle types — including document and message — see e.g. the
     * bundle-duplicate-ids-not and mni-patientOverview baselines, which
     * both flag relative `Composition/1`-style fullUrls in document
     * bundles as errors. The earlier carve-out for document/message was
     * inconsistent with the reference behaviour and is now removed.
     */
    private validateFullUrls(bundle: any, bundleType: string | null): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries: any[] = bundle?.entry ?? [];
        if (entries.length === 0) return issues;

        const seen = new Map<string, number>(); // versioned key → first index

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const fullUrl = entry?.fullUrl;
            if (fullUrl === undefined || fullUrl === null) continue;

            if (typeof fullUrl !== 'string' || fullUrl.length === 0) {
                issues.push(createValidationIssue({
                    code: 'structural-bundle-fullurl-invalid',
                    path: `Bundle.entry[${i}].fullUrl`,
                    resourceType: 'Bundle',
                    customMessage: `Bundle.entry[${i}].fullUrl must be a non-empty string`,
                    severityOverride: 'error',
                }));
                continue;
            }

            // Absolute URI check: scheme followed by ":", and not a bare
            // "ResourceType/id" relative reference.
            const isAbsolute =
                /^[a-z][a-z0-9+.-]*:/i.test(fullUrl) && !/^[A-Za-z]+\/[A-Za-z0-9\-.]+$/.test(fullUrl);
            if (!isAbsolute) {
                issues.push(createValidationIssue({
                    code: 'structural-bundle-fullurl-not-absolute',
                    path: `Bundle.entry[${i}].fullUrl`,
                    resourceType: 'Bundle',
                    customMessage: `The fullUrl must be an absolute URL (not '${fullUrl}')`,
                    severityOverride: 'error',
                }));
                continue;
            }

            if (fullUrl.includes('/_history/')) {
                issues.push(createValidationIssue({
                    code: 'bdl-8-violation',
                    path: `Bundle.entry[${i}].fullUrl`,
                    resourceType: 'Bundle',
                    customMessage: `bdl-8: fullUrl cannot be a version-specific reference (${fullUrl})`,
                    severityOverride: 'error',
                }));
            }

            if (bundleType === 'history') continue;

            // Uniqueness check — key includes versionId to allow distinct versions
            const versionId = entry?.resource?.meta?.versionId;
            const key = versionId ? `${fullUrl}|${versionId}` : fullUrl;
            if (seen.has(key)) {
                issues.push(createValidationIssue({
                    code: 'structural-bundle-fullurl-duplicate',
                    path: `Bundle.entry[${i}].fullUrl`,
                    resourceType: 'Bundle',
                    customMessage:
                        `Duplicate fullUrl "${fullUrl}" — also appears at ` +
                        `Bundle.entry[${seen.get(key)}].fullUrl. ` +
                        `fullUrl values must be unique within a Bundle.`,
                    severityOverride: 'error',
                }));
            } else {
                seen.set(key, i);
            }
        }

        return issues;
    }

    /**
     * Validate that entry.fullUrl is consistent with entry.resource.id.
     *
     * FHIR R4 rule: when a fullUrl looks like a RESTful server URL
     * (i.e. http(s)://host/.../ResourceType/id), the trailing
     * ResourceType/id must match the resource's actual resourceType and id.
     *
     * The HL7 Java validator emits: "The fullUrl 'X' looks like a RESTful
     * server URL, so it must end with the correct type and id (/Type/id)"
     */
    private validateEntryIdConsistency(bundle: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries: any[] = bundle?.entry ?? [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const fullUrl: string | undefined = entry?.fullUrl;
            const res = entry?.resource;
            if (!fullUrl || !res?.resourceType || !res?.id) continue;

            // Only applies to http/https URLs that look like RESTful paths
            if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) continue;

            // Skip urn: and non-REST URLs
            if (fullUrl.startsWith('urn:')) continue;

            // Check if fullUrl ends with ResourceType/id pattern
            const match = fullUrl.match(/\/([A-Z][a-zA-Z]+)\/([^/]+)$/);
            if (!match) continue; // Not a RESTful-looking URL

            const fullUrlType = match[1];
            const fullUrlId = match[2];
            const expectedSuffix = `${res.resourceType}/${res.id}`;

            if (fullUrlType !== res.resourceType || fullUrlId !== res.id) {
                issues.push(createValidationIssue({
                    code: 'bundle-entry-fullurl-id-mismatch',
                    path: `Bundle.entry[${i}]`,
                    resourceType: 'Bundle',
                    customMessage:
                        `The fullUrl '${fullUrl}' looks like a RESTful server URL, ` +
                        `so it must end with the correct type and id ` +
                        `(/${expectedSuffix})`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

    /**
     * Validate that each link relation type appears at most once.
     */
    private validateLinkRelations(bundle: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const links: any[] = bundle?.link ?? [];
        if (links.length === 0) return issues;

        const seen = new Map<string, number>();
        for (let i = 0; i < links.length; i++) {
            const relation = links[i]?.relation;
            if (!relation) continue;
            if (seen.has(relation)) {
                issues.push(createValidationIssue({
                    code: 'invalid',
                    path: `Bundle.link[${i}]`,
                    resourceType: 'Bundle',
                    customMessage: `The link relationship type '${relation}' can only occur once`,
                    severityOverride: 'error',
                }));
            } else {
                seen.set(relation, i);
            }
        }
        return issues;
    }

    /**
     * Returns true when two or more `Bundle.entry[].id` values match. Java's
     * reference validator treats this as a signal that the bundle is in a
     * questionable state and switches to strict reference resolution.
     */
    private bundleHasDuplicateEntryIds(bundle: any): boolean {
        const entries: any[] = bundle?.entry ?? [];
        const seen = new Set<string>();
        for (const e of entries) {
            const id = typeof e?.id === 'string' ? e.id : null;
            if (!id) continue;
            if (seen.has(id)) return true;
            seen.add(id);
        }
        return false;
    }

    /**
     * Detect duplicate entries (same resourceType + id appearing more than once).
     */
    private detectDuplicateEntries(bundle: any): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entries: any[] = bundle?.entry ?? [];
        const seen = new Map<string, number>(); // key → first index

        for (let i = 0; i < entries.length; i++) {
            const res = entries[i]?.resource;
            if (!res?.resourceType || !res?.id) continue;
            // Include versionId in the key so two snapshots of the same
            // logical resource (e.g. Observation/foo@1 and Observation/foo@2
            // in a versioned-reference document bundle) are not flagged as
            // duplicates.
            const versionId = res.meta?.versionId;
            const logical = `${res.resourceType}/${res.id}`;
            const key = versionId ? `${logical}|${versionId}` : logical;
            if (seen.has(key)) {
                issues.push(createValidationIssue({
                    code: 'bundle-duplicate-entry',
                    path: `Bundle.entry[${i}]`,
                    resourceType: 'Bundle',
                    customMessage:
                        `Duplicate entry: ${logical} appears at entry[${seen.get(key)}] and entry[${i}].`,
                    severityOverride: 'error',
                }));
            } else {
                seen.set(key, i);
            }
        }

        return issues;
    }
}

// Singleton instance
export const bundleValidator = new BundleValidator();
