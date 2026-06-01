/**
 * Unit Tests: Element Path Resolver
 * 
 * Tests the conditional cardinality utility functions
 */

import {
  parseElementPath,
  getParentPath,
  isRootElement,
  getAncestorPaths,
  hasParentElement,
  hasAllAncestors as _hasAllAncestors,
  shouldValidateRequired,
} from '../element-path-resolver';
import {
  getValueAtPath,
  isArrayAtPath,
  expandPathWithArrayIndex,
  getValidationTargets
} from '..';

describe('Element Path Resolver', () => {

  describe('parseElementPath', () => {
    it('should parse a simple path', () => {
      const result = parseElementPath('Patient.name', 'Patient');
      expect(result.fullPath).toBe('Patient.name');
      expect(result.resourceType).toBe('Patient');
      expect(result.segments).toEqual(['name']);
      expect(result.parentPath).toBe('Patient');
      expect(result.isRootLevel).toBe(true);
      expect(result.depth).toBe(1);
    });

    it('should parse a nested path', () => {
      const result = parseElementPath('Patient.communication.language', 'Patient');
      expect(result.fullPath).toBe('Patient.communication.language');
      expect(result.resourceType).toBe('Patient');
      expect(result.segments).toEqual(['communication', 'language']);
      expect(result.parentPath).toBe('Patient.communication');
      expect(result.isRootLevel).toBe(false);
      expect(result.depth).toBe(2);
    });

    it('should parse a deeply nested path', () => {
      const result = parseElementPath('Patient.contact.name.given', 'Patient');
      expect(result.segments).toEqual(['contact', 'name', 'given']);
      expect(result.parentPath).toBe('Patient.contact.name');
      expect(result.depth).toBe(3);
    });
  });

  describe('getParentPath', () => {
    it('should return parent for nested path', () => {
      expect(getParentPath('Patient.communication.language')).toBe('Patient.communication');
    });

    it('should return resource type for root element', () => {
      expect(getParentPath('Patient.name')).toBe('Patient');
    });

    it('should return null for resource type itself', () => {
      expect(getParentPath('Patient')).toBeNull();
    });
  });

  describe('isRootElement', () => {
    it('should return true for root elements', () => {
      expect(isRootElement('Patient.name', 'Patient')).toBe(true);
      expect(isRootElement('Patient.gender', 'Patient')).toBe(true);
    });

    it('should return false for nested elements', () => {
      expect(isRootElement('Patient.communication.language', 'Patient')).toBe(false);
      expect(isRootElement('Patient.contact.name', 'Patient')).toBe(false);
    });

    it('should return false for resource type itself', () => {
      expect(isRootElement('Patient', 'Patient')).toBe(false);
    });
  });

  describe('getAncestorPaths', () => {
    it('should return all ancestors', () => {
      const ancestors = getAncestorPaths('Patient.contact.name.given');
      expect(ancestors).toEqual([
        'Patient.contact.name',
        'Patient.contact',
        'Patient'
      ]);
    });

    it('should return single ancestor for nested path', () => {
      const ancestors = getAncestorPaths('Patient.communication.language');
      expect(ancestors).toEqual([
        'Patient.communication',
        'Patient'
      ]);
    });

    it('should return only resource for root element', () => {
      const ancestors = getAncestorPaths('Patient.name');
      expect(ancestors).toEqual(['Patient']);
    });
  });

  describe('getValueAtPath', () => {
    const patient = {
      resourceType: 'Patient',
      name: [{ family: 'Smith' }],
      communication: [{
        language: { coding: [{ code: 'en' }] }
      }]
    };

    it('should get root element value', () => {
      // getValueAtPath unwraps single-element arrays, returning the element directly
      expect(getValueAtPath(patient, 'Patient.name')).toEqual({ family: 'Smith' });
      expect(getValueAtPath(patient, 'name')).toEqual({ family: 'Smith' });
    });

    it('should get nested element value', () => {
      const lang = getValueAtPath(patient, 'Patient.communication.language');
      expect(lang).toEqual({ coding: [{ code: 'en' }] });
    });

    it('should return undefined for missing path', () => {
      expect(getValueAtPath(patient, 'Patient.link')).toBeUndefined();
      expect(getValueAtPath(patient, 'Patient.communication.preferred')).toBeUndefined();
    });

    it('should resolve primitive sidecar-only values', () => {
      const maskedPatient = {
        resourceType: 'Patient',
        identifier: [{
          _value: {
            extension: [{
              url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
              valueCode: 'masked',
            }],
          },
        }],
      };

      expect(getValueAtPath(maskedPatient, 'Patient.identifier.value')).toEqual({
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'masked',
        }],
      });
    });
  });

  describe('hasParentElement - Core Functionality', () => {
    it('should return true for root elements (parent is resource itself)', () => {
      const patient = { resourceType: 'Patient', id: 'test' };
      expect(hasParentElement(patient, 'Patient.name')).toBe(true);
      expect(hasParentElement(patient, 'Patient.gender')).toBe(true);
    });

    it('should return false when parent does not exist', () => {
      const patient = {
        resourceType: 'Patient',
        name: [{ family: 'Smith' }]
        // No communication element
      };
      expect(hasParentElement(patient, 'Patient.communication.language')).toBe(false);
    });

    it('should return true when parent exists', () => {
      const patient = {
        resourceType: 'Patient',
        communication: [{
          preferred: true
          // language missing but communication exists
        }]
      };
      expect(hasParentElement(patient, 'Patient.communication.language')).toBe(true);
    });

    it('should return false when parent is null', () => {
      const patient = {
        resourceType: 'Patient',
        communication: null
      };
      expect(hasParentElement(patient, 'Patient.communication.language')).toBe(false);
    });

    it('should return false when parent is empty array', () => {
      const patient = {
        resourceType: 'Patient',
        communication: []
      };
      expect(hasParentElement(patient, 'Patient.communication.language')).toBe(false);
    });

    it('should return true when parent array has elements', () => {
      const patient = {
        resourceType: 'Patient',
        communication: [{ preferred: true }]
      };
      expect(hasParentElement(patient, 'Patient.communication.language')).toBe(true);
    });
  });

  describe('shouldValidateRequired - Integration', () => {
    it('should always validate root elements', () => {
      const patient = { resourceType: 'Patient', id: 'test' };
      expect(shouldValidateRequired(patient, 'Patient.name')).toBe(true);
      expect(shouldValidateRequired(patient, 'Patient.gender')).toBe(true);
    });

    it('should NOT validate nested element when parent missing', () => {
      const patient = {
        resourceType: 'Patient',
        name: [{ family: 'Smith' }]
        // No communication
      };
      expect(shouldValidateRequired(patient, 'Patient.communication.language')).toBe(false);
    });

    it('should validate nested element when parent exists', () => {
      const patient = {
        resourceType: 'Patient',
        communication: [{ preferred: true }]
      };
      expect(shouldValidateRequired(patient, 'Patient.communication.language')).toBe(true);
    });

    it('should handle deeply nested paths', () => {
      const patient = {
        resourceType: 'Patient',
        contact: [{
          name: {
            // given missing but name exists
            family: 'Smith'
          }
        }]
      };
      expect(shouldValidateRequired(patient, 'Patient.contact.name.given')).toBe(true);
    });

    it('should return false for deeply nested when intermediate parent missing', () => {
      const patient = {
        resourceType: 'Patient',
        contact: [{
          // name missing
          telecom: [{ system: 'phone' }]
        }]
      };
      expect(shouldValidateRequired(patient, 'Patient.contact.name.given')).toBe(false);
    });
  });

  describe('Real-World Scenarios', () => {
    describe('Patient.communication.language', () => {
      it('should NOT require language when no communication', () => {
        const patient = {
          resourceType: 'Patient',
          name: [{ family: 'Test' }]
        };
        expect(shouldValidateRequired(patient, 'Patient.communication.language')).toBe(false);
      });

      it('should require language when communication exists', () => {
        const patient = {
          resourceType: 'Patient',
          communication: [{ preferred: true }]
        };
        expect(shouldValidateRequired(patient, 'Patient.communication.language')).toBe(true);
      });
    });

    describe('Patient.link.other and Patient.link.type', () => {
      it('should NOT require when no link', () => {
        const patient = {
          resourceType: 'Patient',
          name: [{ family: 'Test' }]
        };
        expect(shouldValidateRequired(patient, 'Patient.link.other')).toBe(false);
        expect(shouldValidateRequired(patient, 'Patient.link.type')).toBe(false);
      });

      it('should require when link exists', () => {
        const patient = {
          resourceType: 'Patient',
          link: [{}]  // Empty link element
        };
        expect(shouldValidateRequired(patient, 'Patient.link.other')).toBe(true);
        expect(shouldValidateRequired(patient, 'Patient.link.type')).toBe(true);
      });
    });

    describe('Patient.contact.name', () => {
      it('should NOT require name when no contact', () => {
        const patient = {
          resourceType: 'Patient',
          name: [{ family: 'Test' }]
        };
        expect(shouldValidateRequired(patient, 'Patient.contact.name')).toBe(false);
      });

      it('should require name when contact exists', () => {
        const patient = {
          resourceType: 'Patient',
          contact: [{ relationship: [{ text: 'Emergency' }] }]
        };
        expect(shouldValidateRequired(patient, 'Patient.contact.name')).toBe(true);
      });
    });
  });

  describe('Array-Aware Validation', () => {
    describe('isArrayAtPath', () => {
      it('should detect arrays', () => {
        const patient = {
          resourceType: 'Patient',
          identifier: [{ system: 'http://...', value: '123' }],
          name: [{ family: 'Smith' }],
          gender: 'male'
        };

        expect(isArrayAtPath(patient, 'Patient.identifier')).toBe(true);
        expect(isArrayAtPath(patient, 'Patient.name')).toBe(true);
        expect(isArrayAtPath(patient, 'Patient.gender')).toBe(false);
      });
    });

    describe('expandPathWithArrayIndex', () => {
      it('should insert array index into path', () => {
        const result = expandPathWithArrayIndex('Patient.identifier.system', 'identifier', 0);
        expect(result).toBe('Patient.identifier[0].system');
      });

      it('should handle multiple segments', () => {
        const result = expandPathWithArrayIndex('Patient.contact.telecom.system', 'telecom', 2);
        expect(result).toBe('Patient.contact.telecom[2].system');
      });
    });

    describe('getValidationTargets', () => {
      it('should preserve root resource paths without trailing separators', () => {
        const patient = { resourceType: 'Patient', id: 'p1' };

        const targets = getValidationTargets(patient, 'Patient');

        expect(targets).toHaveLength(1);
        expect(targets[0].value).toBe(patient);
        expect(targets[0].fullPath).toBe('Patient');
        expect(targets[0].contextPath).toBe('Patient');
      });

      it('should return single target for non-array path', () => {
        const patient = {
          resourceType: 'Patient',
          gender: 'male'
        };

        const targets = getValidationTargets(patient, 'Patient.gender');

        expect(targets).toHaveLength(1);
        expect(targets[0].value).toBe('male');
        expect(targets[0].fullPath).toBe('Patient.gender');
        expect(targets[0].isArrayElement).toBe(false);
      });

      it('should expand array into multiple targets', () => {
        const patient = {
          resourceType: 'Patient',
          identifier: [
            { system: 'http://nhs.uk', value: '123' },
            { value: '456' },  // Missing system
            { system: 'http://other.uk', value: '789' }
          ]
        };

        const targets = getValidationTargets(patient, 'Patient.identifier.system');

        expect(targets).toHaveLength(3);

        // First identifier has system
        expect(targets[0].value).toBe('http://nhs.uk');
        expect(targets[0].fullPath).toBe('Patient.identifier[0].system');
        expect(targets[0].contextPath).toBe('Patient.identifier[0]');
        expect(targets[0].isArrayElement).toBe(true);
        expect(targets[0].arrayIndex).toBe(0);

        // Second identifier missing system
        expect(targets[1].value).toBeUndefined();
        expect(targets[1].fullPath).toBe('Patient.identifier[1].system');
        expect(targets[1].contextPath).toBe('Patient.identifier[1]');
        expect(targets[1].isArrayElement).toBe(true);
        expect(targets[1].arrayIndex).toBe(1);

        // Third identifier has system
        expect(targets[2].value).toBe('http://other.uk');
        expect(targets[2].fullPath).toBe('Patient.identifier[2].system');
        expect(targets[2].contextPath).toBe('Patient.identifier[2]');
        expect(targets[2].isArrayElement).toBe(true);
        expect(targets[2].arrayIndex).toBe(2);
      });

      it('should handle nested arrays', () => {
        const patient = {
          resourceType: 'Patient',
          contact: [
            {
              telecom: [
                { system: 'phone', value: '555-1234' },
                { value: '555-5678' }  // Missing system
              ]
            },
            {
              telecom: [
                { system: 'email', value: 'test@example.com' }
              ]
            }
          ]
        };

        const targets = getValidationTargets(patient, 'Patient.contact.telecom.system');

        expect(targets).toHaveLength(3);
        expect(targets[0].fullPath).toBe('Patient.contact[0].telecom[0].system');
        expect(targets[0].value).toBe('phone');

        expect(targets[1].fullPath).toBe('Patient.contact[0].telecom[1].system');
        expect(targets[1].value).toBeUndefined();

        expect(targets[2].fullPath).toBe('Patient.contact[1].telecom[0].system');
        expect(targets[2].value).toBe('email');
      });

      it('should handle empty arrays', () => {
        const patient = {
          resourceType: 'Patient',
          identifier: []
        };

        const targets = getValidationTargets(patient, 'Patient.identifier.system');

        expect(targets).toHaveLength(0);
      });

      it('should handle missing parent', () => {
        const patient = {
          resourceType: 'Patient',
          name: [{ family: 'Smith' }]
          // No identifier
        };

        const targets = getValidationTargets(patient, 'Patient.identifier.system');

        expect(targets).toHaveLength(0);
      });

      it('should validate deeply nested paths in arrays', () => {
        const patient = {
          resourceType: 'Patient',
          contact: [
            {
              name: {
                family: 'Doe'
                // Note: using family instead of given to avoid double array expansion
              }
            },
            {
              name: {
                // Missing family
              }
            }
          ]
        };

        const targets = getValidationTargets(patient, 'Patient.contact.name.family');

        expect(targets).toHaveLength(2);
        expect(targets[0].value).toBe('Doe');
        expect(targets[0].fullPath).toBe('Patient.contact[0].name.family');
        expect(targets[1].value).toBeUndefined();
        expect(targets[1].fullPath).toBe('Patient.contact[1].name.family');
      });

      it('should preserve primitive sidecar-only values as present targets', () => {
        const patient = {
          resourceType: 'Patient',
          identifier: [{
            _value: {
              extension: [{
                url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
                valueCode: 'masked',
              }],
            },
          }],
        };

        const targets = getValidationTargets(patient, 'Patient.identifier.value');

        expect(targets).toHaveLength(1);
        expect(targets[0].fullPath).toBe('Patient.identifier[0].value');
        expect(targets[0].contextPath).toBe('Patient.identifier[0]');
        expect(targets[0].value).toEqual({
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'masked',
          }],
        });
      });
    });

    describe('Real-World Array Scenarios', () => {
      it('should validate Patient.identifier.system in multiple identifiers', () => {
        const patient = {
          resourceType: 'Patient',
          identifier: [
            { system: 'http://nhs.uk', value: '9876543210' },
            { value: '456' },  // ✗ Missing system
            { system: 'http://other.uk', value: '789' }
          ]
        };

        const targets = getValidationTargets(patient, 'Patient.identifier.system');
        const missingTargets = targets.filter(t => t.value === undefined || t.value === null);

        expect(missingTargets).toHaveLength(1);
        expect(missingTargets[0].fullPath).toBe('Patient.identifier[1].system');
      });

      it('should validate Patient.link.other in multiple links', () => {
        const patient = {
          resourceType: 'Patient',
          link: [
            { other: { reference: 'Patient/123' }, type: 'seealso' },
            { type: 'replaces' },  // ✗ Missing other
            { other: { reference: 'Patient/789' }, type: 'replaced-by' }
          ]
        };

        const targets = getValidationTargets(patient, 'Patient.link.other');
        const missingTargets = targets.filter(t => t.value === undefined || t.value === null);

        expect(missingTargets).toHaveLength(1);
        expect(missingTargets[0].fullPath).toBe('Patient.link[1].other');
      });

      it('should validate Patient.communication.language in multiple communications', () => {
        const patient = {
          resourceType: 'Patient',
          communication: [
            { language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en' }] } },
            { preferred: true },  // ✗ Missing language
            { language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'es' }] } }
          ]
        };

        const targets = getValidationTargets(patient, 'Patient.communication.language');
        const missingTargets = targets.filter(t => t.value === undefined || t.value === null);

        expect(missingTargets).toHaveLength(1);
        expect(missingTargets[0].fullPath).toBe('Patient.communication[1].language');
      });
    });
  });
});
