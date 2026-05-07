/**
 * German Identifier Validator
 * 
 * Validates German health insurance identifiers (GKV/PKV) for:
 * - Correct assigner identifier system
 * - Proper identifier slice matching
 * 
 * German GKV (gesetzliche Krankenversicherung) and PKV (private Krankenversicherung)
 * identifiers require specific assigner systems.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

// ============================================================================
// Types
// ============================================================================

interface Identifier {
    system?: string;
    value?: string;
    assigner?: {
        identifier?: {
            system?: string;
            value?: string;
        };
        display?: string;
        reference?: string;
    };
}

// ============================================================================
// German System Definitions
// ============================================================================

/**
 * Mapping of German identifier systems to their expected assigner systems
 */
const GERMAN_IDENTIFIER_SYSTEMS: Record<string, {
    name: string;
    expectedAssignerSystem: string;
}> = {
    // GKV (Gesetzliche Krankenversicherung) KVID-10
    'http://fhir.de/sid/gkv/kvid-10': {
        name: 'GKV (Gesetzliche Krankenversicherung)',
        expectedAssignerSystem: 'http://fhir.de/sid/arge-ik/iknr',
    },
    // PKV (Private Krankenversicherung) KVID-10
    'http://fhir.de/sid/pkv/kvid-10': {
        name: 'PKV (Private Krankenversicherung)',
        expectedAssignerSystem: 'http://fhir.de/sid/arge-ik/iknr',
    },
};

/**
 * Known valid German assigner systems
 */
const _VALID_GERMAN_ASSIGNER_SYSTEMS = new Set([
    'http://fhir.de/sid/arge-ik/iknr',  // IK-Nummer (Institutionskennzeichen)
]);

// ============================================================================
// German Identifier Validator
// ============================================================================

export class GermanIdentifierValidator {
    /**
     * Validate German identifiers in a resource
     * 
     * @param resource - FHIR resource containing identifiers
     * @param profileUrl - Profile URL for issue reporting
     * @returns Array of validation issues
     */
    validateIdentifiers(
        resource: { resourceType: string; identifier?: Identifier[] },
        profileUrl: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!resource.identifier || !Array.isArray(resource.identifier)) {
            return issues;
        }

        for (let i = 0; i < resource.identifier.length; i++) {
            const identifier = resource.identifier[i];
            const identifierPath = `${resource.resourceType}.identifier[${i}]`;

            const identifierIssues = this.validateSingleIdentifier(
                identifier,
                identifierPath,
                resource.resourceType,
                profileUrl
            );
            issues.push(...identifierIssues);
        }

        return issues;
    }

    /**
     * Validate a single identifier
     */
    private validateSingleIdentifier(
        identifier: Identifier,
        path: string,
        resourceType: string,
        profileUrl: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Skip if no system or not a German identifier
        if (!identifier.system) {
            return issues;
        }

        const germanConfig = GERMAN_IDENTIFIER_SYSTEMS[identifier.system];
        if (!germanConfig) {
            return issues;  // Not a German identifier system, skip
        }

        // Check assigner identifier system
        if (identifier.assigner?.identifier) {
            const assignerSystem = identifier.assigner.identifier.system;

            if (!assignerSystem) {
                // Assigner identifier exists but has no system
                issues.push(createValidationIssue({
                    code: 'profile-constraint-violation',
                    path: `${path}.assigner.identifier.system`,
                    resourceType,
                    profile: profileUrl,
                    customMessage: `${germanConfig.name} identifier requires assigner.identifier.system to be specified (expected: ${germanConfig.expectedAssignerSystem})`,
                    details: {
                        identifierSystem: identifier.system,
                        expectedAssignerSystem: germanConfig.expectedAssignerSystem,
                        actualAssignerSystem: null,
                    },
                }));
            } else if (assignerSystem !== germanConfig.expectedAssignerSystem) {
                // Invalid assigner system
                issues.push(createValidationIssue({
                    code: 'profile-constraint-violation',
                    path: `${path}.assigner.identifier.system`,
                    resourceType,
                    profile: profileUrl,
                    customMessage: `${germanConfig.name} identifier assigner.identifier.system must be '${germanConfig.expectedAssignerSystem}', found: '${assignerSystem}'`,
                    details: {
                        identifierSystem: identifier.system,
                        expectedAssignerSystem: germanConfig.expectedAssignerSystem,
                        actualAssignerSystem: assignerSystem,
                    },
                }));
            }
        }

        return issues;
    }

    /**
     * Check if a profile URL suggests German content
     */
    isGermanProfile(profileUrl?: string): boolean {
        if (!profileUrl) return false;

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
