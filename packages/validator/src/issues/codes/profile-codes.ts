/**
 * Profile Validation Codes
 * 
 * Codes for profile/constraint validation including slicing and extensions.
 */

import type { ValidationCodeMetadata } from './validation-code-types';

export const ProfileCodes = {
    'profile-constraint-violation': {
        aspect: 'profile',
        severity: 'error',
        description: 'Profile constraint violated',
    },
    'profile-slice-min-cardinality': {
        aspect: 'profile',
        severity: 'error',
        description: 'Slice minimum cardinality not met',
    },
    'profile-slice-max-cardinality': {
        aspect: 'profile',
        severity: 'error',
        description: 'Slice maximum cardinality exceeded',
    },
    'profile-slice-closed-unmatched': {
        aspect: 'profile',
        severity: 'error',
        description: 'Unmatched element in closed slicing',
    },
    'profile-slice-ordering-violation': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Slice ordering violated',
    },
    'profile-slice-validation-error': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Slice validation failed',
    },
    'profile-extension-invalid': {
        aspect: 'profile',
        severity: 'error',
        description: 'Invalid extension',
    },
    'profile-extension-url-missing': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension is missing URL',
    },
    'profile-extension-url-not-absolute': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension URL must be an absolute URL',
    },
    'profile-extension-not-found': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Extension StructureDefinition could not be resolved',
    },
    'profile-extension-not-in-profile': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Extension not defined in profile',
    },
    'profile-extension-modifier-mismatch': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension used as modifier but not declared as modifier',
    },
    'profile-extension-no-value': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension must have value or nested extensions',
    },
    'profile-extension-value-and-nested': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension cannot have both value and nested extensions',
    },
    'profile-extension-invalid-value-type': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension has invalid value type',
    },
    'profile-extension-missing-value': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension is missing required value',
    },
    'profile-extension-min-cardinality': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension minimum cardinality not met',
    },
    'profile-extension-max-cardinality': {
        aspect: 'profile',
        severity: 'error',
        description: 'Extension maximum cardinality exceeded',
    },
    'profile-extension-validation-error': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Extension validation failed',
    },
    'profile-extension-missing': {
        aspect: 'profile',
        severity: 'error',
        description: 'Required extension is missing',
    },
    'profile-slicing-violation': {
        aspect: 'profile',
        severity: 'error',
        description: 'Slicing constraint violated',
    },
    'profile-mustsupport-missing': {
        aspect: 'profile',
        severity: 'warning',
        description: 'MustSupport element is not populated',
    },
    'profile-validation-error': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Profile validation failed',
    },
    'profile-not-found': {
        aspect: 'profile',
        severity: 'info',
        description: 'Profile could not be loaded',
    },
    'profile-downloading': {
        aspect: 'profile',
        severity: 'info',
        description: 'Profile is being downloaded',
    },
    'profile-download-failed': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Profile download failed',
    },
    'profile-load-error': {
        aspect: 'profile',
        severity: 'warning',
        description: 'Profile could not be loaded',
    },
} as const satisfies Record<string, ValidationCodeMetadata>;

export type ProfileCode = keyof typeof ProfileCodes;
