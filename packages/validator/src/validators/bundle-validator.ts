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
import { validateBundleCrossEntryReferences } from './bundle-cross-entry-references';
import {
    bundleHasDuplicateEntryIds,
    detectDuplicateBundleEntries,
    validateBundleEntryIdConsistency,
    validateBundleFullUrls,
    validateBundleLinkRelations,
} from './bundle-entry-rules';
import { validateBundleReachability } from './bundle-reachability';
import { extractReferencesWithPaths } from './bundle-reference-utils';
import { validateSearchsetBundle } from './bundle-searchset-rules';

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
            const strictRefs = bundleHasDuplicateEntryIds(resource);

            // 3b. For document/message bundles: every entry should be
            //     reachable from the Composition / MessageHeader by walking
            //     references forwards or backwards. Java emits these as
            //     `error/informational` per orphan entry.
            if (bundleType === 'document' || bundleType === 'message') {
                issues.push(...validateBundleReachability(resource, bundleType, strictRefs));
            }

            // 4. Cross-entry referential integrity (K-3)
            issues.push(...validateBundleCrossEntryReferences(resource, bundleType, strictRefs));

            // 5. Entry duplication detection (by resourceType/id)
            issues.push(...detectDuplicateBundleEntries(resource));

            // 6. fullUrl presence check (FHIR R4: fullUrl is mandatory in
            //    document/message/transaction/batch bundles)
            issues.push(...this.validateFullUrlPresence(resource, bundleType));

            // 7. fullUrl format + uniqueness (FHIR spec: Bundle.entry.fullUrl must
            //    be an absolute URL and unique across the Bundle)
            issues.push(...validateBundleFullUrls(resource, bundleType));

            // 8. fullUrl ↔ resource.id consistency (FHIR R4: when fullUrl
            //    looks like a RESTful URL, its trailing ResourceType/id must
            //    match the resource)
            issues.push(...validateBundleEntryIdConsistency(resource));

            // 9. Duplicate link relation types
            issues.push(...validateBundleLinkRelations(resource));

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
                issues.push(...validateSearchsetBundle(bundle, entries));
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

    // ==========================================================================
    // Cross-Entry Referential Integrity (K-3)
    // ==========================================================================

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
                    extractReferencesWithPaths(entry.resource, '', refsWithPaths);
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
}


// Singleton instance
export const bundleValidator = new BundleValidator();
