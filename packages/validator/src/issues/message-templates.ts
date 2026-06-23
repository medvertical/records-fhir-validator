/**
 * Validation Message Templates
 *
 * Template strings for all validation message codes.
 * Templates support variable interpolation using {variable} placeholders.
 *
 * Format convention: "{Entity} {problem}: {details}"
 * Examples:
 *   - "Code '{code}' is not in value set '{valueSet}' (binding strength: required)"
 *   - "versionId is longer than recommended: {length} characters"
 */

import { ValidationCode } from './message-catalog';

// ============================================================================
// Message Templates
// ============================================================================

export const MessageTemplates: Partial<Record<ValidationCode, string>> = {
    // -------------------------------------------------------------------------
    // Terminology
    // -------------------------------------------------------------------------
    'terminology-binding-required':
        "Code '{code}' from system '{system}' is not in value set '{valueSet}' (binding strength: required)",
    'terminology-binding-extensible':
        "Code '{code}' from system '{system}' is not in value set '{valueSet}' (binding strength: extensible)",
    'terminology-binding-preferred':
        "Code '{code}' from system '{system}' is not in value set '{valueSet}' (binding strength: preferred)",
    'terminology-binding-example':
        "Code '{code}' from system '{system}' is not in value set '{valueSet}' (binding strength: example)",
    // Primitive code types (no system property)
    'terminology-binding-required-code':
        "Code '{code}' is not in value set '{valueSet}' (binding strength: required)",
    'terminology-binding-extensible-code':
        "Code '{code}' is not in value set '{valueSet}' (binding strength: extensible)",
    'terminology-binding-preferred-code':
        "Code '{code}' is not in value set '{valueSet}' (binding strength: preferred)",
    'terminology-binding-example-code':
        "Code '{code}' is not in value set '{valueSet}' (binding strength: example)",
    'terminology-binding-missing':
        "Required binding is missing a value at {path}",
    'terminology-valueset-error':
        "ValueSet validation failed: {error}",
    'terminology-binding-unverified':
        "Code '{code}' could not be verified against value set '{valueSet}' (binding strength: {strength}) — no local expansion and no terminology server confirmation available",

    // -------------------------------------------------------------------------
    // Metadata - Version ID
    // -------------------------------------------------------------------------
    'metadata-version-id-invalid-type':
        "versionId must be a string",
    'metadata-version-id-empty':
        "versionId cannot be empty",
    'metadata-version-id-invalid-format':
        "versionId does not match FHIR id type pattern: {value}",
    'metadata-version-id-timestamp-pattern':
        "versionId appears to be a timestamp: {value}",
    'metadata-version-id-non-positive':
        "versionId should be a positive number: {value}",
    'metadata-version-id-special-chars-only':
        "versionId should not consist only of special characters: {value}",
    'metadata-version-id-etag-format':
        "versionId appears to be in ETag format: {value}",
    'metadata-version-id-same-as-id':
        "versionId should not be the same as resource.id",
    'metadata-version-id-very-high':
        "versionId is unusually high: {value}",
    'metadata-version-id-validation-error':
        "versionId validation failed: {error}",

    // -------------------------------------------------------------------------
    // Metadata - Last Updated
    // -------------------------------------------------------------------------
    'metadata-last-updated-invalid-type':
        "lastUpdated must be a string",
    'metadata-last-updated-missing-timezone':
        "lastUpdated is missing timezone indicator",
    'metadata-last-updated-invalid-format':
        "lastUpdated does not match instant format: {value}",
    'metadata-last-updated-non-utc':
        "lastUpdated uses non-UTC timezone: {value}",
    'metadata-last-updated-missing-seconds':
        "lastUpdated is missing seconds precision",
    'metadata-last-updated-future':
        "lastUpdated is in the future: {value}",
    'metadata-last-updated-old':
        "lastUpdated is very old (before {threshold}): {value}",
    'metadata-last-updated-unix-epoch':
        "lastUpdated is near Unix epoch: {value}",
    'metadata-last-updated-at-midnight':
        "lastUpdated is exactly at midnight (possibly truncated): {value}",
    'metadata-last-updated-validation-error':
        "lastUpdated validation failed: {error}",
    'metadata-chronological-order-violation':
        "Timestamps are not in chronological order",
    'metadata-identical-timestamps':
        "Multiple timestamps have identical values",

    // -------------------------------------------------------------------------
    // Metadata - Tags
    // -------------------------------------------------------------------------
    'metadata-tag-invalid-array':
        "meta.tag must be an array",
    'metadata-tag-invalid-object':
        "Tag at index {index} must be an object",
    'metadata-tag-missing-system-code':
        "Tag at index {index} should have system and/or code",
    'metadata-tag-missing-code':
        "Tag at index {index} should have a code",
    'metadata-tag-invalid-system-type':
        "Tag system must be a string at index {index}",
    'metadata-tag-invalid-system-uri':
        "Tag system is not a valid URI: {system}",
    'metadata-tag-invalid-code-type':
        "Tag code must be a string at index {index}",
    'metadata-tag-invalid-display-type':
        "Tag display must be a string at index {index}",
    'metadata-tag-code-without-system':
        "Tag has code without system at index {index}",
    'metadata-tag-duplicate':
        "Tag at index {index} is duplicated at index {duplicateIndex}",
    'metadata-tag-short-display':
        "Tag display is very short at index {index}: \"{display}\"",
    'metadata-tag-code-as-display':
        "Tag display appears to be same as code at index {index}",
    'metadata-tag-long-display':
        "Tag display is very long at index {index}: {length} characters",

    // -------------------------------------------------------------------------
    // Metadata - Security
    // -------------------------------------------------------------------------
    'metadata-security-invalid-array':
        "meta.security must be an array",
    'metadata-security-invalid-object':
        "Security label at index {index} must be an object",
    'metadata-security-missing-system':
        "Security label at index {index} is missing system",
    'metadata-security-missing-code':
        "Security label at index {index} is missing code",
    'metadata-security-invalid-system':
        "Security system is not a valid URI at index {index}: {system}",
    'metadata-security-invalid-code-type':
        "Security code must be a string at index {index}",
    'metadata-security-invalid-display-type':
        "Security display must be a string at index {index}",
    'metadata-security-duplicate':
        "Security label at index {index} is duplicated",
    'metadata-security-missing-display':
        "Security label at index {index} is missing display",
    'metadata-security-unknown-code':
        "Unknown security code: {code}",
    'metadata-security-unknown-system':
        "Unknown security system: {system}",

    // -------------------------------------------------------------------------
    // Metadata - Source
    // -------------------------------------------------------------------------
    'metadata-source-invalid-type':
        "source must be a string",
    'metadata-source-empty':
        "source cannot be empty",
    'metadata-source-too-long':
        "source is longer than recommended: {length} characters",
    'metadata-source-invalid-format':
        "source is not a valid URI: {value}",
    'metadata-source-localhost':
        "source references localhost: {value}",
    'metadata-source-looks-like-reference':
        "source looks like a FHIR reference: {value}",
    'metadata-source-relative-uri':
        "source is a relative URI: {value}",
    'metadata-source-validation-error':
        "source validation failed: {error}",

    // -------------------------------------------------------------------------
    // Metadata - Profile
    // -------------------------------------------------------------------------
    'metadata-profile-invalid-array':
        "meta.profile must be an array",
    'metadata-profile-invalid-type':
        "Profile entry at index {index} must be a string",
    'metadata-profile-invalid-url':
        "Profile URL is not valid: {url}",
    'metadata-profile-resource-type-mismatch':
        "Profile {profile} does not match resource type {resourceType}",
    'metadata-profile-duplicate':
        "Profile is declared multiple times: {profile}",
    'metadata-profile-not-accessible':
        "Profile is not accessible: {profile}",
    'metadata-profile-wrong-resource-type':
        "Profile is for wrong resource type (expected {expected}, got {actual})",

    // -------------------------------------------------------------------------
    // Metadata - General
    // -------------------------------------------------------------------------
    'metadata-missing-meta':
        "Resource is missing meta element",
    'metadata-invalid-meta-type':
        "meta must be an object",

    // -------------------------------------------------------------------------
    // Reference
    // -------------------------------------------------------------------------
    'reference-empty':
        "Reference is empty",
    'reference-invalid-contained':
        "Invalid contained reference format: {reference}",
    'reference-invalid-url':
        "Invalid reference URL: {reference}",
    'reference-invalid-format':
        "Invalid reference format: {reference}",
    'reference-type-mismatch':
        "Reference type '{actual}' does not match allowed types: {allowed}",
    'reference-type-unknown':
        "Unknown reference type: {type}",
    'reference-contained-not-found':
        "Contained reference not found: {reference}",
    'reference-contained-type-mismatch':
        "Contained reference type mismatch: expected {expected}, got {actual}",
    'reference-contained-type-unknown':
        "Unknown contained reference type: {type}",
    'reference-not-found':
        "Referenced resource not found: {reference}",
    'reference-validation-error':
        "Reference validation failed: {error}",

    // -------------------------------------------------------------------------
    // Reference - Bundle
    // -------------------------------------------------------------------------
    'reference-bundle-unresolved':
        "Unresolved bundle reference: {reference}",
    'reference-bundle-duplicate-fullurl':
        "Duplicate fullUrl in bundle: {fullUrl}",
    'reference-bundle-fullurl-mismatch':
        "Bundle fullUrl does not match resource: {fullUrl}",
    'reference-bundle-missing-type':
        "Bundle is missing type",
    'reference-bundle-missing-entries':
        "Bundle is missing entries",
    'reference-bundle-invalid-entries':
        "Bundle entries are invalid",
    'reference-bundle-entry-missing-request':
        "Bundle entry at index {index} is missing request",
    'reference-bundle-request-missing-method':
        "Bundle request at index {index} is missing method",
    'reference-bundle-request-missing-url':
        "Bundle request at index {index} is missing url",

    // -------------------------------------------------------------------------
    // Structural
    // -------------------------------------------------------------------------
    'structural-required-element-missing':
        "Required element {element} is missing",
    'structural-resource-type-mismatch':
        "Resource type {actual} does not match expected {expected}",
    'structural-missing-resource-type':
        "Resource is missing resourceType",
    'structural-invalid-json':
        "Invalid JSON: {error}",
    'structural-cardinality-violation':
        "Cardinality violated for {element}: expected {expected}, found {actual}",
    'structural-type-mismatch':
        "Type mismatch for {element}: expected {expected}, found {actual}",
    'structural-validation-error':
        "Structural validation failed: {error}",
    'structural-hapi-error':
        "HAPI validation error: {message}",
    'structural-cardinality-min':
        "Element {element} has too few values: expected at least {min}, found {actual}",
    'structural-cardinality-max':
        "Element {element} has too many values: expected at most {max}, found {actual}",

    // -------------------------------------------------------------------------
    // Profile
    // -------------------------------------------------------------------------
    'profile-constraint-violation':
        "Constraint '{key}' violated: {message}",
    'profile-slice-min-cardinality':
        "Slice '{slice}' minimum cardinality not met: expected at least {min}, found {actual}",
    'profile-slice-max-cardinality':
        "Slice '{slice}' maximum cardinality exceeded: expected at most {max}, found {actual}",
    'profile-slice-closed-unmatched':
        "Element does not match any slice in closed slicing: {path}",
    'profile-slice-ordering-violation':
        "Slice ordering violated at {path}",
    'profile-slice-validation-error':
        "Slice validation failed: {error}",
    'profile-extension-invalid':
        "Invalid extension: {url}",
    'profile-extension-url-missing':
        "Extension is missing required url property",
    'profile-extension-url-not-absolute':
        "Extension.url must be an absolute URL (got '{url}')",
    'profile-extension-not-found':
        "The extension {url} could not be found so is not allowed here",
    'profile-extension-not-in-profile':
        "Extension '{url}' is not defined in the profile",
    'profile-extension-modifier-mismatch':
        "Extension '{url}' is used as modifierExtension but not declared as modifier",
    'profile-extension-no-value':
        "Extension '{url}' must have either a value or nested extensions",
    'profile-extension-value-and-nested':
        "Extension '{url}' cannot have both a value and nested extensions",
    'profile-extension-invalid-value-type':
        "Extension '{url}' has invalid value type {valueType}, allowed types: {allowedTypes}",
    'profile-extension-missing-value':
        "Extension '{url}' is missing required value at {requiredPath}",
    'profile-extension-min-cardinality':
        "Extension '{url}' requires at least {min} instance(s), found {found}",
    'profile-extension-max-cardinality':
        "Extension '{url}' allows at most {max} instance(s), found {found}",
    'profile-extension-validation-error':
        "Extension validation failed: {error}",
    'profile-extension-missing':
        "Required extension is missing: {url}",
    'profile-slicing-violation':
        "Slicing constraint violated at {path}",
    'profile-mustsupport-missing':
        "MustSupport element is not populated; verify support or availability when applicable: {element}",
    'profile-validation-error':
        "Profile validation failed: {error}",
    'profile-not-found':
        "Profile could not be loaded: {profile}",
    'profile-downloading':
        "Downloading profile: {profile}",
    'profile-download-failed':
        "Profile download failed: {profile}",
    'profile-load-error':
        "Profile could not be loaded: {profile}",

    // -------------------------------------------------------------------------
    // Business Rules
    // -------------------------------------------------------------------------
    'business-rule-violation':
        "Business rule violated: {message}",
    'business-value-out-of-range':
        "Value {value} is out of acceptable range ({min}-{max})",
    'business-negative-value':
        "Value should not be negative: {value}",
    'business-invalid-effective-date':
        "Invalid effective date: {date}",
    'business-future-effective-date':
        "Effective date is in the future: {date}",
    'business-final-status-no-value':
        "Final status requires a value",
    'business-invalid-onset-date':
        "Invalid onset date: {date}",
    'business-future-onset-date':
        "Onset date is in the future: {date}",
    'business-invalid-birth-date':
        "Invalid birth date: {date}",
    'business-future-birth-date':
        "Birth date is in the future: {date}",
    'business-unreasonable-age':
        "Age is unreasonable: {age} years",
    'business-invalid-period-start':
        "Invalid period start date: {date}",
    'business-invalid-period-end':
        "Invalid period end date: {date}",
    'business-end-before-start':
        "Period end ({end}) is before start ({start})",
    'business-finished-status-no-end':
        "Finished status but no end date provided",
    'business-validation-error':
        "Business rule validation failed: {error}",

    // -------------------------------------------------------------------------
    // Generic
    // -------------------------------------------------------------------------
    'validation-error':
        "Validation error: {message}",
};

// ============================================================================
// Template Formatting
// ============================================================================

/**
 * Format a message template with parameters.
 * Replaces {variable} placeholders with values from params.
 *
 * @param code - The validation code
 * @param params - Object containing variable values
 * @returns Formatted message string
 */
export function formatMessage(
    code: string,
    params: Record<string, unknown> = {}
): string {
    const template = MessageTemplates[code as ValidationCode];

    if (!template) {
        // Fall back to a generic format using params
        if (params.message) {
            return String(params.message);
        }
        return `Validation issue: ${code}`;
    }

    let result = template;
    for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? ''));
    }

    return result;
}

/**
 * Human-readable template for UI display.
 * Can be customized separately from diagnostic messages.
 */
export const HumanReadableTemplates: Partial<Record<ValidationCode, string>> = {
    // Add human-readable templates as needed - uses MessageTemplates as fallback
};

/**
 * Get human-readable message for a code.
 */
export function getHumanReadableMessage(
    code: string,
    params: Record<string, unknown> = {}
): string {
    const template =
        HumanReadableTemplates[code as ValidationCode] ||
        MessageTemplates[code as ValidationCode];

    if (!template) {
        return formatMessage(code, params);
    }

    let result = template;
    for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? ''));
    }

    return result;
}
