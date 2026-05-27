/**
 * Validation Aspect Helper Functions
 * 
 * Low-level helper functions for working with validation aspects.
 * Extracted to avoid circular dependencies between settings-utils and settings-validators.
 */

import type { ValidationSettings } from './settings';
import type { ValidationAspect, ValidationSeverity } from './enums';
import { VALIDATION_ASPECTS } from './settings-types';
import { normalizeValidationAspect, normalizeValidationAspects } from './aspect-aliases';

/**
 * Get all enabled validation aspects from settings
 */
export function getEnabledAspects(settings: ValidationSettings): ValidationAspect[] {
    if (!settings?.aspects) {
        return [];
    }

    const aspects = normalizeValidationAspects(settings.aspects);
    return VALIDATION_ASPECTS.filter((aspect: ValidationAspect) => {
        const aspectConfig = aspects[aspect];
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

    const normalizedAspect = normalizeValidationAspect(aspect) as ValidationAspect;
    const aspectConfig = normalizeValidationAspects(settings.aspects)[normalizedAspect];
    return aspectConfig?.enabled === true;
}

/**
 * Get severity for a specific aspect
 */
export function getAspectSeverity(settings: ValidationSettings, aspect: ValidationAspect): ValidationSeverity {
    if (!settings?.aspects) {
        return 'warning'; // Default severity
    }

    const normalizedAspect = normalizeValidationAspect(aspect) as ValidationAspect;
    const aspectConfig = normalizeValidationAspects(settings.aspects)[normalizedAspect];
    return aspectConfig?.severity || 'warning';
}
