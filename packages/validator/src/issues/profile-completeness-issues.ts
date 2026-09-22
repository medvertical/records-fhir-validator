/**
 * Issues that make a skipped profile check visible instead of silent.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from './issue-factory.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

/**
 * Create a "profile could not be loaded" completeness diagnostic.
 *
 * The loader already answers `null` for a profile that is simply not there, so
 * a thrown failure is something else: the store was unreadable, the definition
 * did not parse, the cache failed. Collapsing both into "no profile" skips the
 * snapshot-based checks and returns a result that looks cleaner than it is.
 *
 * Severity is `warning` rather than `error`: the resource is not known to be
 * wrong, only unchecked against this profile.
 */
export function createProfileUnreadable(params: {
    profileUrl: string;
    resourceType: string;
    path?: string;
    reason: 'structural-profile' | 'claimed-profile' | 'base-definition';
    error?: unknown;
}): ValidationIssue {
    return createValidationIssue({
        code: 'profile-unreadable',
        path: params.path ?? params.resourceType,
        resourceType: params.resourceType,
        severityOverride: 'warning',
        customMessage: params.reason === 'base-definition'
            ? `The base definition '${params.profileUrl}' could not be loaded, so properties `
              + 'outside the profile could not be checked against it. Unknown-element '
              + 'findings are withheld rather than reported on an unverified basis.'
            : `Profile '${params.profileUrl}' could not be loaded, so the resource was not `
              + 'checked against it. This is a profile availability problem, not a finding '
              + 'about the resource.',
        details: {
            validationStatus: 'incomplete',
            reason: params.reason,
            ...profileCanonicalMetadata(params.profileUrl),
            ...(params.error === undefined ? {} : validationFailureMetadata(params.error)),
        },
    });
}
