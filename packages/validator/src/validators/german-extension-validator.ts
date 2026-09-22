/**
 * German Extension Validator
 * 
 * Validates German-specific extension requirements:
 * - Gender extension (gender-amtlich-de) required when gender is "other"
 * - Other conditional extension requirements for German profiles
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * German gender extension URL
 * Required when Patient.gender = "other"
 */
const GENDER_AMTLICH_DE_URL = 'http://fhir.de/StructureDefinition/gender-amtlich-de';

/**
 * Extension can also appear on the _gender element
 */
const _GENDER_EXTENSION_PATHS = [
    'gender',
    '_gender',
];

// ============================================================================
// German Extension Validator
// ============================================================================

export class GermanExtensionValidator {
    /**
     * Validate German extension requirements for a resource
     * 
     * @param resource - FHIR resource to validate
     * @param profileUrl - Profile URL for issue reporting
     * @returns Array of validation issues
     */
    validateExtensions(
        resource: unknown,
        profileUrl: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Only validate Patient resources for now
        if (!isObjectRecord(resource) || resource.resourceType !== 'Patient') {
            return issues;
        }

        // Check gender extension requirement
        const genderIssues = this.validateGenderExtension(resource, profileUrl);
        issues.push(...genderIssues);

        return issues;
    }

    /**
     * Validate that gender extension is present when gender = "other"
     * 
     * Per German profiles (MII, KBV), when Patient.gender is "other",
     * the gender-amtlich-de extension MUST be present to specify the
     * administrative gender (D = divers, X = unbestimmt).
     */
    private validateGenderExtension(
        patient: Record<string, unknown>,
        profileUrl: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Only check if gender is "other"
        if (patient.gender !== 'other') {
            return issues;
        }

        // Look for the gender extension in multiple locations
        const hasGenderExtension = this.hasExtension(patient, GENDER_AMTLICH_DE_URL);

        if (!hasGenderExtension) {
            issues.push(createValidationIssue({
                code: 'profile-extension-missing',
                path: 'Patient.gender',
                resourceType: 'Patient',
                profile: profileUrl,
                customMessage: `When gender is "other", extension "${GENDER_AMTLICH_DE_URL}" is required to specify the administrative gender (D = divers, X = unbestimmt)`,
                details: {
                    gender: patient.gender,
                    expectedExtension: GENDER_AMTLICH_DE_URL,
                    validValues: ['D (divers)', 'X (unbestimmt)'],
                },
            }));
        }

        return issues;
    }

    /**
     * Check if a resource has a specific extension
     * 
     * Checks multiple locations where extensions can appear:
     * - Resource.extension (root level)
     * - Resource._gender.extension (primitive extension)
     */
    private hasExtension(resource: Record<string, unknown>, extensionUrl: string): boolean {
        // Check root-level extensions
        if (hasExtensionUrl(resource.extension, extensionUrl)) {
            return true;
        }

        // Check _gender primitive extension (common location for this extension)
        const genderMetadata = isObjectRecord(resource._gender) ? resource._gender : null;
        if (genderMetadata && hasExtensionUrl(genderMetadata.extension, extensionUrl)) {
            return true;
        }

        return false;
    }

    /**
     * Check if a profile URL suggests German content
     * Uses same logic as GermanIdentifierValidator for consistency
     */
    isGermanProfile(profileUrl: string): boolean {
        const germanProfilePatterns = [
            'fhir.de',
            'medizininformatik-initiative.de',
            'kbv.de',
            'gematik.de',
        ];

        return germanProfilePatterns.some(pattern =>
            profileUrl.toLowerCase().includes(pattern)
        );
    }
}

function hasExtensionUrl(value: unknown, extensionUrl: string): boolean {
    return Array.isArray(value) && value.some(extension =>
        isObjectRecord(extension) && extension.url === extensionUrl
    );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
