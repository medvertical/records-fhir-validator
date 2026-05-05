/**
 * Tests for locale-aware PII detection in SecurityValidator.
 *
 * Covers:
 * - DE-locale narrative patterns (KVNR, Steuer-ID, IBAN, phone, address)
 * - DE-locale identifier patterns (KVNR, Steuer-ID, IKNR, IBAN)
 * - Locale isolation: 'de' does NOT fire US patterns and vice-versa
 * - 'all' locale fires both US and DE patterns
 */

import { describe, it, expect } from 'vitest';
import { SecurityValidator } from '../../validators/security-validator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResource(overrides: Record<string, any> = {}) {
    return { resourceType: 'Patient', ...overrides };
}

function narrativeResource(text: string) {
    return makeResource({ text: { div: `<div>${text}</div>` } });
}

function identifierResource(value: string) {
    return makeResource({ identifier: [{ value }] });
}

// ---------------------------------------------------------------------------
// DE-locale narrative detection
// ---------------------------------------------------------------------------

describe('SecurityValidator — DE locale narrative detection', () => {
    const validator = new SecurityValidator({ piiLocale: 'de' });

    it('detects KVNR in narrative', () => {
        const issues = validator.validate(narrativeResource('Patient KVNR: A123456789'));
        expect(issues.some(i => i.code === 'security-phi-kvnr-detected')).toBe(true);
    });

    it('detects bare KVNR pattern (letter + 9 digits)', () => {
        const issues = validator.validate(narrativeResource('ID ist B987654321 laut Karte'));
        expect(issues.some(i => i.code === 'security-phi-kvnr-detected')).toBe(true);
    });

    it('detects Versichertennummer label', () => {
        const issues = validator.validate(narrativeResource('Versichertennummer: C111222333'));
        expect(issues.some(i => i.code === 'security-phi-kvnr-detected')).toBe(true);
    });

    it('detects Steuer-ID in narrative', () => {
        const issues = validator.validate(narrativeResource('Steuer-ID: 12345678901'));
        expect(issues.some(i => i.code === 'security-phi-steuerid-detected')).toBe(true);
    });

    it('detects IdNr variant', () => {
        const issues = validator.validate(narrativeResource('IdNr: 12345678901'));
        expect(issues.some(i => i.code === 'security-phi-steuerid-detected')).toBe(true);
    });

    it('detects German phone number (+49)', () => {
        const issues = validator.validate(narrativeResource('Telefon: +49 30 12345678'));
        expect(issues.some(i => i.code === 'security-phi-de-phone-in-narrative')).toBe(true);
    });

    it('detects German phone number (0-prefix)', () => {
        const issues = validator.validate(narrativeResource('Anruf: 030/12345678'));
        expect(issues.some(i => i.code === 'security-phi-de-phone-in-narrative')).toBe(true);
    });

    it('detects German address', () => {
        const issues = validator.validate(narrativeResource('Wohnt in Hauptstraße 42'));
        expect(issues.some(i => i.code === 'security-phi-de-address-in-narrative')).toBe(true);
    });

    it('detects DE IBAN in narrative', () => {
        const issues = validator.validate(narrativeResource('IBAN: DE89 3704 0044 0532 0130 00'));
        expect(issues.some(i => i.code === 'security-phi-iban-in-narrative')).toBe(true);
    });

    it('does NOT fire US SSN pattern when locale is de', () => {
        const issues = validator.validate(narrativeResource('SSN: 123-45-6789'));
        expect(issues.some(i => i.code === 'security-phi-ssn-detected')).toBe(false);
    });

    it('does NOT fire US phone pattern when locale is de', () => {
        const issues = validator.validate(narrativeResource('Call (212) 555-0100'));
        expect(issues.some(i => i.code === 'security-phi-phone-in-narrative')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// DE-locale identifier detection
// ---------------------------------------------------------------------------

describe('SecurityValidator — DE locale identifier detection', () => {
    const validator = new SecurityValidator({ piiLocale: 'de' });

    it('detects KVNR in identifier value', () => {
        const issues = validator.validate(identifierResource('A123456789'));
        expect(issues.some(i => i.code === 'security-sensitive-kvnr-identifier')).toBe(true);
    });

    it('detects Steuer-ID in identifier value', () => {
        const issues = validator.validate(identifierResource('Steuer-ID: 12345678901'));
        expect(issues.some(i => i.code === 'security-sensitive-steuerid-identifier')).toBe(true);
    });

    it('detects IKNR in identifier value', () => {
        const issues = validator.validate(identifierResource('IKNR: 123456789'));
        expect(issues.some(i => i.code === 'security-sensitive-iknr-identifier')).toBe(true);
    });

    it('detects IBAN in identifier value', () => {
        const issues = validator.validate(identifierResource('DE89370400440532013000'));
        expect(issues.some(i => i.code === 'security-sensitive-iban-identifier')).toBe(true);
    });

    it('does NOT fire SSN pattern when locale is de', () => {
        const issues = validator.validate(identifierResource('123-45-6789'));
        expect(issues.some(i => i.code === 'security-sensitive-ssn-identifier')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// US-locale isolation
// ---------------------------------------------------------------------------

describe('SecurityValidator — US locale isolation', () => {
    const validator = new SecurityValidator({ piiLocale: 'us' });

    it('fires SSN detection in narrative', () => {
        const issues = validator.validate(narrativeResource('SSN: 123-45-6789'));
        expect(issues.some(i => i.code === 'security-phi-ssn-detected')).toBe(true);
    });

    it('does NOT fire KVNR detection in narrative', () => {
        const issues = validator.validate(narrativeResource('KVNR: A123456789'));
        expect(issues.some(i => i.code === 'security-phi-kvnr-detected')).toBe(false);
    });

    it('does NOT fire DE IBAN detection in narrative', () => {
        const issues = validator.validate(narrativeResource('IBAN: DE89 3704 0044 0532 0130 00'));
        expect(issues.some(i => i.code === 'security-phi-iban-in-narrative')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 'all' locale — both US and DE
// ---------------------------------------------------------------------------

describe('SecurityValidator — all locale fires both', () => {
    const validator = new SecurityValidator({ piiLocale: 'all' });

    it('fires SSN detection', () => {
        const issues = validator.validate(narrativeResource('SSN: 123-45-6789'));
        expect(issues.some(i => i.code === 'security-phi-ssn-detected')).toBe(true);
    });

    it('fires KVNR detection', () => {
        const issues = validator.validate(narrativeResource('KVNR: A123456789'));
        expect(issues.some(i => i.code === 'security-phi-kvnr-detected')).toBe(true);
    });

    it('fires both US phone and DE phone detection', () => {
        const resource = narrativeResource('Call 212-555-0100 or +49 30 12345678');
        const issues = validator.validate(resource);
        expect(issues.some(i => i.code === 'security-phi-phone-in-narrative')).toBe(true);
        expect(issues.some(i => i.code === 'security-phi-de-phone-in-narrative')).toBe(true);
    });

    it('fires DE IBAN detection', () => {
        const issues = validator.validate(narrativeResource('IBAN: DE89 3704 0044 0532 0130 00'));
        expect(issues.some(i => i.code === 'security-phi-iban-in-narrative')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Default locale is 'us'
// ---------------------------------------------------------------------------

describe('SecurityValidator — default locale', () => {
    const validator = new SecurityValidator();

    it('defaults to US locale (detects SSN)', () => {
        const issues = validator.validate(narrativeResource('SSN: 123-45-6789'));
        expect(issues.some(i => i.code === 'security-phi-ssn-detected')).toBe(true);
    });

    it('defaults to US locale (no KVNR)', () => {
        const issues = validator.validate(narrativeResource('KVNR: A123456789'));
        expect(issues.some(i => i.code === 'security-phi-kvnr-detected')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Locale-independent patterns still fire regardless
// ---------------------------------------------------------------------------

describe('SecurityValidator — locale-independent patterns', () => {
    it('detects email regardless of locale', () => {
        for (const locale of ['us', 'de', 'all'] as const) {
            const v = new SecurityValidator({ piiLocale: locale });
            const issues = v.validate(narrativeResource('Contact: patient@example.com'));
            expect(issues.some(i => i.code === 'security-phi-email-in-narrative')).toBe(true);
        }
    });

    it('detects DOB regardless of locale', () => {
        for (const locale of ['us', 'de', 'all'] as const) {
            const v = new SecurityValidator({ piiLocale: locale });
            const issues = v.validate(narrativeResource('DOB: 01/15/1990'));
            expect(issues.some(i => i.code === 'security-phi-dob-in-narrative')).toBe(true);
        }
    });
});
