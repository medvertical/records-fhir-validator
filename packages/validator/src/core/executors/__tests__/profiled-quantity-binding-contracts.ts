import { describe, expect, it, vi } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types.js';
import { ValueSetCache } from '../../../validators/valueset-cache.js';
import { ValueSetValidator } from '../../../validators/valueset-validator.js';
import { UcumCodeValidator } from '../../../validators/ucum-validator.js';
import { CodeSystemReferenceLookupCache } from '../terminology-code-system-reference-rules.js';
import { validateTerminologyElement } from '../terminology-element-validator.js';
import { TerminologySlicePlanCache } from '../terminology-slice-plan-cache.js';

export interface ProfiledQuantityFixtures {
  profile: StructureDefinition;
  ageUnits: unknown;
  input: Record<string, unknown>;
  malformedPrimitive: Record<string, unknown>;
}

export function registerProfiledQuantityBindingContracts(fixtures: ProfiledQuantityFixtures): void {
  const { profile, ageUnits, input, malformedPrimitive } = fixtures;
  const quantityElement = profile.differential!.element.find(element => element.path === 'Observation.value[x]')!;

  async function checkQuantity(options: { code?: string; available?: boolean; bound?: boolean; mixedChoice?: boolean; codedChoice?: boolean } = {}) {
    const resource = structuredClone(input);
    const quantity = resource.valueQuantity as Record<string, unknown>;
    if (options.code) quantity.code = options.code;
    const elementDef: ElementDefinition = structuredClone(quantityElement);
    if (options.bound === false) delete elementDef.binding;
    if (options.mixedChoice) elementDef.type = [{ code: 'CodeableConcept' }, { code: 'Quantity' }];
    const selectedValue = options.codedChoice ? { coding: [{ system: quantity.system, code: quantity.code }] } : quantity;
    if (options.codedChoice) {
      delete resource.valueQuantity; resource.valueCodeableConcept = selectedValue;
      elementDef.type = [{ code: 'CodeableConcept' }, { code: 'Quantity' }];
    }
    const cache = new ValueSetCache();
    const validator = new ValueSetValidator(cache, undefined, []);
    validator.setResolutionConfig({ strategy: 'local-only', servers: [], serverUrl: '',
      reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: false,
      serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 } });
    if (options.available !== false) expect(validator.registerExternalTerminologyResource(ageUnits, 'R4')).toBe(true);
    return validator.withSourceContext({ fhirVersion: 'R4' }, () => validateTerminologyElement({
      resource, elementDef, structureDef: profile, profileUrl: profile.url, fhirVersion: 'R4',
      getValueAtPath: () => selectedValue,
    }, {
      valueSetCache: cache, valueSetValidator: validator, slicePlanCache: new TerminologySlicePlanCache(),
      codeSystemReferenceLookupCache: new CodeSystemReferenceLookupCache(), ucumValidator: new UcumCodeValidator(),
    }));
  }

  describe('explicit profiled Quantity unit membership and independent UCUM syntax', () => {
    it('rejects the cm against its required four-unit ValueSet despite valid UCUM syntax', async () => {
      const issues = await checkQuantity();
      expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-required', severity: 'error',
        path: 'Observation.valueQuantity', profile: profile.url }));
      expect(issues.some(issue => issue.code === 'terminology-code-invalid')).toBe(false);
      expect(issues.some(issue => issue.code === 'terminology-binding-extensible')).toBe(false);
    });

    it('accepts an explicitly allowed age unit', async () => {
      const issues = await checkQuantity({ code: 'a' });
      expect(issues).toEqual([]);
    });

    it('retains Unknown when the own required ValueSet is unavailable', async () => {
      const issues = await checkQuantity({ available: false });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified',
        details: expect.objectContaining({ validationStatus: 'incomplete' }) }));
      expect(issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
    });

    it('accepts native cm syntax when no ValueSet restriction is declared', async () => {
      expect(await checkQuantity({ bound: false })).toEqual([]);
    });

    it('still rejects invalid unit syntax without a ValueSet restriction', async () => {
      const issues = await checkQuantity({ bound: false, code: 'invalid-unit' });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-code-invalid', severity: 'error',
        path: 'Observation.valueQuantity.code' }));
    });

    it('does not apply a mixed coded choice binding to its Quantity alternative', async () => {
      expect(await checkQuantity({ mixedChoice: true })).toEqual([]);
    });
  });


  describe('required mixed-choice binding on its actual coded alternative', () => {
    it('rejects a coded cm outside the own four-unit ValueSet as required', async () => {
      const issues = await checkQuantity({ codedChoice: true });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-required', severity: 'error', path: 'Observation.valueCodeableConcept' }));
      expect(issues.some(issue => issue.code === 'terminology-binding-extensible')).toBe(false);
    });
    it('accepts an allowed coded a under the same required binding', async () => {
      expect(await checkQuantity({ codedChoice: true, code: 'a' })).toEqual([]);
    });
    it('keeps unavailable own ValueSet authority Unknown for the coded alternative', async () => {
      const issues = await checkQuantity({ codedChoice: true, available: false });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified', details: expect.objectContaining({ validationStatus: 'incomplete' }) }));
      expect(issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
    });
  });


  describe('required Quantity binding does not code-validate the malformed primitive', () => {
    async function checkOriginal(available: boolean) {
      const resource = structuredClone(malformedPrimitive);
      const cache = new ValueSetCache();
      const validator = new ValueSetValidator(cache, undefined, []);
      validator.setResolutionConfig({ strategy: 'local-only', servers: [], serverUrl: '',
        reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: false,
        serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 } });
      if (available) expect(validator.registerExternalTerminologyResource(ageUnits, 'R4')).toBe(true);
      const membership = vi.spyOn(validator, 'validateBinding');
      const issues = await validator.withSourceContext({ fhirVersion: 'R4' }, () => validateTerminologyElement({
        resource, elementDef: quantityElement, structureDef: profile, profileUrl: profile.url, fhirVersion: 'R4',
        getValueAtPath: () => resource.valueString,
      }, {
        valueSetCache: cache, valueSetValidator: validator, slicePlanCache: new TerminologySlicePlanCache(),
        codeSystemReferenceLookupCache: new CodeSystemReferenceLookupCache(), ucumValidator: new UcumCodeValidator(),
      }));
      expect(membership).not.toHaveBeenCalled();
      expect(issues).toEqual([]);
    }

    it('retains the structural-only ownership when the own age-units ValueSet is available', async () => {
      await checkOriginal(true);
    });

    it('does not invent membership Unknown for an inapplicable unit binding when the own ValueSet is absent', async () => {
      await checkOriginal(false);
    });
  });

}
