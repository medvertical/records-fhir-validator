/**
 * Provenance Chain Validator
 *
 * Validates a `Provenance` resource's linkage to the resources it describes.
 * The FHIR Provenance resource records information about the entity, activity
 * and agent involved in producing a piece of data — so the chain it creates
 * between authoring agents and target resources is a core data-quality signal.
 *
 * This validator checks the **structural** aspects of the chain (the parts
 * that do not require network access):
 *
 * 1. `Provenance.target` MUST be present and non-empty
 * 2. Every `target.reference` MUST be a well-formed FHIR reference
 *    (`ResourceType/id`, canonical URL, absolute URL, or `urn:uuid:…`)
 * 3. `Provenance.recorded` MUST be present and MUST be a valid FHIR `instant`
 * 4. `Provenance.agent` SHOULD contain at least one entry, and each agent
 *    SHOULD have either `who.reference` or `who.identifier`
 * 5. `Provenance.occurredDateTime` / `Provenance.occurredPeriod`, when
 *    present, SHOULD NOT post-date `recorded` (provenance cannot be recorded
 *    before the event it describes)
 *
 * Remote resolution of `target.reference` (checking that each referenced
 * resource actually exists on the current FHIR server) is shared with the
 * generic remote reference existence check in §4.1.4 of the PRD and is
 * therefore **out of scope** here. This keeps provenance validation
 * deterministic and offline-safe.
 */

import type { ValidationIssue } from '../types';

// ============================================================================
// Constants
// ============================================================================

/**
 * FHIR `instant` format: ISO 8601 with at minimum second precision and a
 * timezone designator. Mirrors the core FHIR instant regex (simplified).
 */
const FHIR_INSTANT_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Well-formed reference patterns:
 * - `ResourceType/id`                     — relative reference
 * - `ResourceType/id/_history/version`    — versioned relative reference
 * - `http[s]://…/ResourceType/id`         — absolute reference
 * - `urn:uuid:…`                          — placeholder reference (bundles)
 * - `urn:oid:…`                           — OID-based reference
 */
const REFERENCE_PATTERNS: RegExp[] = [
    /^[A-Z][A-Za-z0-9]*\/[A-Za-z0-9\-.]{1,64}(?:\/_history\/[A-Za-z0-9\-.]{1,64})?$/,
    /^https?:\/\/\S+\/[A-Z][A-Za-z0-9]*\/[A-Za-z0-9\-.]{1,64}(?:\/_history\/[A-Za-z0-9\-.]{1,64})?$/,
    /^urn:uuid:[0-9a-fA-F-]{8,}$/,
    /^urn:oid:[0-9.]+$/,
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate a Provenance resource's chain linkage.
 *
 * Returns an empty array when `resource.resourceType !== 'Provenance'` so
 * callers can pass any resource without branching.
 */
export function validateProvenanceChain(resource: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!isProvenance(resource)) return issues;

    validateTargets(resource, issues);
    validateRecorded(resource, issues);
    validateAgents(resource, issues);
    validateOccurredVsRecorded(resource, issues);

    return issues;
}

// ============================================================================
// Internal Checks
// ============================================================================

interface ProvenanceResource {
    resourceType: 'Provenance';
    id?: string;
    target?: Array<{ reference?: string; type?: string; identifier?: unknown }>;
    recorded?: string;
    agent?: Array<{
        who?: { reference?: string; identifier?: unknown; display?: string };
        type?: unknown;
        role?: unknown;
    }>;
    occurredDateTime?: string;
    occurredPeriod?: { start?: string; end?: string };
}

function isProvenance(resource: unknown): resource is ProvenanceResource {
    return (
        typeof resource === 'object' &&
        resource !== null &&
        (resource as { resourceType?: unknown }).resourceType === 'Provenance'
    );
}

function validateTargets(
    resource: ProvenanceResource,
    issues: ValidationIssue[],
): void {
    const targets = resource.target;

    if (!Array.isArray(targets) || targets.length === 0) {
        issues.push(
            buildIssue({
                resource,
                severity: 'error',
                code: 'provenance-missing-target',
                path: 'Provenance.target',
                message:
                    'Provenance.target is required and must reference at least one resource.',
                humanReadable:
                    'Every Provenance resource must point to the resource(s) it describes.',
            }),
        );
        return;
    }

    targets.forEach((target, index) => {
        const path = `Provenance.target[${index}]`;
        if (!target || typeof target !== 'object') {
            issues.push(
                buildIssue({
                    resource,
                    severity: 'error',
                    code: 'provenance-target-invalid',
                    path,
                    message: `Provenance.target[${index}] must be an object with a reference.`,
                }),
            );
            return;
        }

        const ref = target.reference;
        const hasIdentifier = target.identifier != null;

        if (typeof ref !== 'string' || ref.trim().length === 0) {
            // Logical reference via identifier is allowed (FHIR Reference rule),
            // so only warn if neither reference nor identifier is present.
            if (!hasIdentifier) {
                issues.push(
                    buildIssue({
                        resource,
                        severity: 'error',
                        code: 'provenance-target-missing-reference',
                        path: `${path}.reference`,
                        message: `Provenance.target[${index}] must have a reference or identifier.`,
                    }),
                );
            }
            return;
        }

        if (!isWellFormedReference(ref)) {
            issues.push(
                buildIssue({
                    resource,
                    severity: 'error',
                    code: 'provenance-target-malformed-reference',
                    path: `${path}.reference`,
                    message: `Provenance.target[${index}].reference "${ref}" is not a well-formed FHIR reference.`,
                    humanReadable:
                        'References must be of the form ResourceType/id, an absolute URL, or a urn:uuid: placeholder.',
                }),
            );
        }
    });
}

function validateRecorded(
    resource: ProvenanceResource,
    issues: ValidationIssue[],
): void {
    const recorded = resource.recorded;
    if (recorded === undefined || recorded === null || recorded === '') {
        issues.push(
            buildIssue({
                resource,
                severity: 'error',
                code: 'provenance-missing-recorded',
                path: 'Provenance.recorded',
                message: 'Provenance.recorded is required.',
                humanReadable:
                    'Provenance records must capture when the authoring activity was recorded.',
            }),
        );
        return;
    }

    if (typeof recorded !== 'string' || !FHIR_INSTANT_RE.test(recorded)) {
        issues.push(
            buildIssue({
                resource,
                severity: 'error',
                code: 'provenance-invalid-recorded',
                path: 'Provenance.recorded',
                message: `Provenance.recorded "${recorded}" is not a valid FHIR instant.`,
                humanReadable:
                    'Use an ISO 8601 instant with timezone, e.g. 2026-04-08T10:15:30Z',
            }),
        );
    }
}

function validateAgents(
    resource: ProvenanceResource,
    issues: ValidationIssue[],
): void {
    const agents = resource.agent;
    if (!Array.isArray(agents) || agents.length === 0) {
        issues.push(
            buildIssue({
                resource,
                severity: 'error',
                code: 'provenance-missing-agent',
                path: 'Provenance.agent',
                message: 'Provenance.agent requires at least one entry.',
                humanReadable:
                    'Every Provenance resource must record who performed the activity.',
            }),
        );
        return;
    }

    agents.forEach((agent, index) => {
        const path = `Provenance.agent[${index}]`;
        const who = agent?.who;
        const hasReference =
            who && typeof who.reference === 'string' && who.reference.trim().length > 0;
        const hasIdentifier = who && who.identifier != null;

        if (!who || (!hasReference && !hasIdentifier)) {
            issues.push(
                buildIssue({
                    resource,
                    severity: 'warning',
                    code: 'provenance-agent-missing-who',
                    path: `${path}.who`,
                    message: `Provenance.agent[${index}].who should have a reference or identifier.`,
                    humanReadable:
                        'Agents should identify a specific actor (via reference or identifier) rather than a free-text display.',
                }),
            );
            return;
        }

        if (hasReference && !isWellFormedReference(who!.reference!)) {
            issues.push(
                buildIssue({
                    resource,
                    severity: 'error',
                    code: 'provenance-agent-malformed-reference',
                    path: `${path}.who.reference`,
                    message: `Provenance.agent[${index}].who.reference "${who!.reference}" is not a well-formed FHIR reference.`,
                }),
            );
        }
    });
}

function validateOccurredVsRecorded(
    resource: ProvenanceResource,
    issues: ValidationIssue[],
): void {
    const recorded = resource.recorded;
    if (typeof recorded !== 'string' || !FHIR_INSTANT_RE.test(recorded)) {
        return; // Recorded already reported invalid above
    }

    const recordedTs = Date.parse(recorded);
    if (Number.isNaN(recordedTs)) return;

    let eventTs: number | undefined;
    if (typeof resource.occurredDateTime === 'string') {
        const parsed = Date.parse(resource.occurredDateTime);
        if (!Number.isNaN(parsed)) eventTs = parsed;
    } else if (resource.occurredPeriod && typeof resource.occurredPeriod === 'object') {
        // Use the period end if present, otherwise the start
        const end = resource.occurredPeriod.end;
        const start = resource.occurredPeriod.start;
        if (typeof end === 'string') {
            const parsed = Date.parse(end);
            if (!Number.isNaN(parsed)) eventTs = parsed;
        } else if (typeof start === 'string') {
            const parsed = Date.parse(start);
            if (!Number.isNaN(parsed)) eventTs = parsed;
        }
    }

    if (eventTs !== undefined && eventTs > recordedTs) {
        issues.push(
            buildIssue({
                resource,
                severity: 'warning',
                code: 'provenance-recorded-before-event',
                path: 'Provenance.recorded',
                message:
                    'Provenance.recorded precedes the occurred date/time of the described activity.',
                humanReadable:
                    'The recording timestamp should be at or after the described event.',
            }),
        );
    }
}

// ============================================================================
// Helpers
// ============================================================================

function isWellFormedReference(ref: string): boolean {
    return REFERENCE_PATTERNS.some(pattern => pattern.test(ref));
}

interface BuildIssueInput {
    resource: ProvenanceResource;
    severity: 'error' | 'warning' | 'info';
    code: string;
    path: string;
    message: string;
    humanReadable?: string;
}

function buildIssue({
    resource,
    severity,
    code,
    path,
    message,
    humanReadable,
}: BuildIssueInput): ValidationIssue {
    return {
        id: `${code}-${resource.id ?? 'unknown'}-${Date.now()}`,
        aspect: 'metadata',
        severity,
        code,
        message,
        path,
        humanReadable: humanReadable ?? message,
        details: {
            validationType: 'provenance-chain-check',
            resourceType: 'Provenance',
        },
        validationMethod: 'provenance-chain-check',
        timestamp: new Date().toISOString(),
        resourceType: 'Provenance',
        schemaVersion: 'R4',
    } as ValidationIssue;
}
