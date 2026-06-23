
import { describe, it, expect } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';

// fhirpath.js only exposes memberOf as an async function, which our synchronous
// compiled-expression path rejects. ConstraintValidator handles boolean
// `<prefix>.memberOf('<ValueSet>')` constraints via evaluateTrailingMemberOf:
// it evaluates the prefix synchronously and applies the shared sync memberOf
// logic (ISO-3166 hardcoded sets + expanded-ValueSet cache).
describe('ConstraintValidator - memberOf (ISO specific)', () => {

    it('should validate ISO-3166-1-2 country codes correctly', async () => {
        const validator = new ConstraintValidator();
        const resource = {
            resourceType: 'Patient',
            address: [
                { country: 'DE' },
                { country: 'US' },
                { country: 'XX' } // Invalid
            ]
        };

        // Constraint Expression similar to MII
        // Note: iterating over address for simplicity in test setup, although actual constraint might be on Address type
        // We'll simulate a constraint on Patient that checks address.country

        // Test 1: Valid Code DE
        const elementsDE = [{
            path: 'Patient',
            constraint: [{
                key: 'iso-check-de',
                severity: 'warning' as const,
                human: 'Country must be valid ISO',
                expression: "address.where(country = 'DE').country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')"
            }]
        }];

        const issuesDE = await validator.validate(resource, elementsDE as any, 'http://profile');
        expect(issuesDE).toHaveLength(0); // Should pass

        // Test 2: Valid Code US
        const elementsUS = [{
            path: 'Patient',
            constraint: [{
                key: 'iso-check-us',
                severity: 'warning' as const,
                human: 'Country must be valid ISO',
                expression: "address.where(country = 'US').country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')"
            }]
        }];

        const issuesUS = await validator.validate(resource, elementsUS as any, 'http://profile');
        expect(issuesUS).toHaveLength(0); // Should pass

        // Test 3: Invalid Code XX
        const elementsXX = [{
            path: 'Patient',
            constraint: [{
                key: 'iso-check-xx',
                severity: 'warning' as const,
                human: 'ountry must be valid ISO',
                expression: "address.where(country = 'XX').country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')"
            }]
        }];

        const issuesXX = await validator.validate(resource, elementsXX as any, 'http://profile');
        expect(issuesXX).toHaveLength(1);
        expect(issuesXX[0].code).toBe('profile-constraint-warning');
    });

    it('should validate ISO-3166-1-3 country codes correctly', async () => {
        const validator = new ConstraintValidator();
        const resource = {
            resourceType: 'Patient',
            address: [
                { country: 'DEU' },
                { country: 'USA' },
                { country: 'XXX' }
            ]
        };

        // Test 1: Valid Code DEU
        const elementsDEU = [{
            path: 'Patient',
            constraint: [{
                key: 'iso-check-deu',
                severity: 'warning' as const,
                human: 'Country must be valid ISO 3',
                expression: "address.where(country = 'DEU').country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-3')"
            }]
        }];

        const issuesDEU = await validator.validate(resource, elementsDEU as any, 'http://profile');
        expect(issuesDEU).toHaveLength(0);

        // Test 2: Invalid Code XXX
        const elementsXXX = [{
            path: 'Patient',
            constraint: [{
                key: 'iso-check-xxx',
                severity: 'warning' as const,
                human: 'Country must be valid ISO 3',
                expression: "address.where(country = 'XXX').country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-3')"
            }]
        }];

        const issuesXXX = await validator.validate(resource, elementsXXX as any, 'http://profile');
        expect(issuesXXX).toHaveLength(1);
    });
});
