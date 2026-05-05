/**
 * Validation Aspect Helper Functions
 * 
 * Low-level helper functions for working with validation aspects.
 * Extracted to avoid circular dependencies between settings-utils and settings-validators.
 */

import type { ValidationSettings } from './settings';
import type { ValidationAspect, ValidationSeverity } from './enums';
import { VALIDATION_ASPECTS } from './settings-types';

/**
 * Get all enabled validation aspects from settings
 */
export function getEnabledAspects(settings: ValidationSettings): ValidationAspect[] {
    if (!settings?.aspects) {
        return [];
    }

    return VALIDATION_ASPECTS.filter((aspect: ValidationAspect) => {
        const aspectConfig = settings.aspects[aspect];
        return aspectConfig?.enabled === true;
    });
}

/**
 * Check if a specific aspect is enabled
 */
export function isAspectEnabled(settings: ValidationSettings, aspect: ValidationAspect): boolean {
    if (!settings?.aspects) {
        return false;
    }

    const aspectConfig = settings.aspects[aspect];
    return aspectConfig?.enabled === true;
}

/**
 * Get severity for a specific aspect
 */
export function getAspectSeverity(settings: ValidationSettings, aspect: ValidationAspect): ValidationSeverity {
    if (!settings?.aspects) {
        return 'warning'; // Default severity
    }

    const aspectConfig = settings.aspects[aspect];
    return aspectConfig?.severity || 'warning';
}
