/**
 * Terminology Validation Codes
 * 
 * Codes for terminology/value set binding validation.
 */

import type { ValidationCodeMetadata } from './validation-code-types';

export const TerminologyCodes = {
    'terminology-binding-required': {
        aspect: 'terminology',
        severity: 'error',
        description: 'Code not in required value set binding',
    },
    'terminology-binding-extensible': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'Code not in extensible value set binding',
    },
    'terminology-binding-preferred': {
        aspect: 'terminology',
        severity: 'info',
        description: 'Code not in preferred value set binding',
    },
    'terminology-binding-example': {
        aspect: 'terminology',
        severity: 'info',
        description: 'Code not in example value set binding',
    },
    // Primitive code types (no system property in FHIR)
    'terminology-binding-required-code': {
        aspect: 'terminology',
        severity: 'error',
        description: 'Primitive code not in required value set binding',
    },
    'terminology-binding-extensible-code': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'Primitive code not in extensible value set binding',
    },
    'terminology-binding-preferred-code': {
        aspect: 'terminology',
        severity: 'info',
        description: 'Primitive code not in preferred value set binding',
    },
    'terminology-binding-example-code': {
        aspect: 'terminology',
        severity: 'info',
        description: 'Primitive code not in example value set binding',
    },
    'terminology-binding-missing': {
        aspect: 'terminology',
        severity: 'error',
        description: 'Required binding code is missing',
    },
    'terminology-valueset-error': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'ValueSet validation failed',
    },
    'terminology-display-mismatch': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'Coding display does not match CodeSystem concept display',
    },
    'terminology-code-inactive': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'CodeSystem concept is inactive',
    },
    'terminology-coding-system-valueset': {
        aspect: 'terminology',
        severity: 'error',
        description: 'Coding.system references a ValueSet instead of a CodeSystem',
    },
    'terminology-codesystem-unresolvable': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'CodeSystem is not available in configured terminology sources',
    },
    'terminology-server-failure': {
        aspect: 'terminology',
        severity: 'warning',
        description: 'Terminology server failed or timed out while validating the code',
    },
} as const satisfies Record<string, ValidationCodeMetadata>;

export type TerminologyCode = keyof typeof TerminologyCodes;
