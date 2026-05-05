/**
 * German Extension Validator
 * 
 * Validates German-specific extension requirements:
 * - Gender extension (gender-amtlich-de) required when gender is "other"
 * - Other conditional extension requirements for German profiles
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

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
// Types
// ============================================================================

interface Extension {
    url: string;
    valueCode?: string;
    valueCoding?: { system?: string; code?: string };
    [key: string]: unknown;
}

interface PatientResource {
    resourceType: 'Patient';
    gender?: 'male' | 'female' | 'other' | 'unknown';
    _gender?: { extension?: Extension[] };
    extension?: Extension[];
}

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
        resource: PatientResource,
        profileUrl: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Only validate Patient resources for now
        if (resource.resourceType !== 'Patient') {
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
        patient: PatientResource,
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
    private hasExtension(resource: PatientResource, extensionUrl: string): boolean {
        // Check root-level extensions
        if (resource.extension?.some(ext => ext.url === extensionUrl)) {
            return true;
        }

        // Check _gender primitive extension (common location for this extension)
        if (resource._gender?.extension?.some(ext => ext.url === extensionUrl)) {
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
