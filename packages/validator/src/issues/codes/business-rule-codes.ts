/**
 * Business Rule Validation Codes
 * 
 * Codes for business/clinical rule validation.
 */

import type { ValidationCodeMetadata } from './validation-code-types';

export const BusinessRuleCodes = {
    'business-rule-violation': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Business rule violated',
    },
    'business-value-out-of-range': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Value is out of acceptable range',
    },
    'business-negative-value': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Value should not be negative',
    },
    'business-invalid-effective-date': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Invalid effective date',
    },
    'business-future-effective-date': {
        aspect: 'customRule',
        severity: 'warning',
        description: 'Effective date is in the future',
    },
    'business-final-status-no-value': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Final status requires value',
    },
    'business-invalid-onset-date': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Invalid onset date',
    },
    'business-future-onset-date': {
        aspect: 'customRule',
        severity: 'warning',
        description: 'Onset date is in the future',
    },
    'business-invalid-birth-date': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Invalid birth date',
    },
    'business-future-birth-date': {
        aspect: 'customRule',
        severity: 'warning',
        description: 'Birth date is in the future',
    },
    'business-unreasonable-age': {
        aspect: 'customRule',
        severity: 'warning',
        description: 'Age is unreasonable',
    },
    'business-invalid-period-start': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Invalid period start date',
    },
    'business-invalid-period-end': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Invalid period end date',
    },
    'business-end-before-start': {
        aspect: 'customRule',
        severity: 'error',
        description: 'Period end is before start',
    },
    'business-finished-status-no-end': {
        aspect: 'customRule',
        severity: 'warning',
        description: 'Finished status but no end date',
    },
    'business-validation-error': {
        aspect: 'customRule',
        severity: 'warning',
        description: 'Business rule validation failed',
    },
} as const satisfies Record<string, ValidationCodeMetadata>;

export type BusinessRuleCode = keyof typeof BusinessRuleCodes;
