import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../core/structure-definition-types';
import type { CodeSystem, ValueSet } from './valueset-types';
import metadata from './__fixtures__/memberof-mcode-metadata.json';
import { ConstraintValidator } from './constraint-validator';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor';
import { ValueSetCache } from './valueset-cache';

const definition = metadata.definition as StructureDefinition;
const valueSet = metadata.valueSet as ValueSet;
const codeSystem = metadata.codeSystem as CodeSystem;
const constraint = definition.snapshot!.element[0].constraint![0];
const system = 'http://hl7.org/fhir/us/core/CodeSystem/condition-category';

// This preserves the original rule and terminology metadata, not a full profile verdict.
describe('mCODE us-core-1 source metadata', () => {
  it('pins the reference source bytes and business versions', () => {
    expect(metadata.origins).toEqual({
      sd: { package: 'hl7.fhir.us.mcode#2.1.0', file: 'StructureDefinition-mcode-primary-cancer-condition.json',
        sha256: '9d894b7290a0a5474cc54594ed5cb46864693634b16f5df7b8a4939d94c302de' },
      vs: { package: 'hl7.fhir.us.core#4.0.0', file: 'ValueSet-us-core-condition-category.json',
        sha256: 'c187cb4b0e750538c9bc77d4a4596362fa4b3707af0e215d5b3c8b9e20962990' },
      cs: { package: 'hl7.terminology.r4#7.2.0', file: 'CodeSystem-condition-category.json',
        sha256: '8ec95bcebb940efc083466cdbbed153f6e50b37e1a5fb49cc41934257cbf5df5' },
    });
    expect(definition.version).toBe('2.1.0');
    expect(valueSet.version).toBe('4.0.0');
    expect(codeSystem.content).toBe('complete');
    expect(constraint.expression).toBe("where(category.memberOf('http://hl7.org/fhir/us/core/ValueSet/us-core-condition-category')).exists()");
    expect(valueSet.compose?.include).toContainEqual(expect.objectContaining({ system,
      concept: expect.arrayContaining([expect.objectContaining({ code: 'health-concern' })]) }));
  });

  describe.each(['general', 'StructureDefinition'] as const)('%s isolated constraint', implementation => {
    it.each(['valid', 'wrong-system', 'rejected'] as const)('decides %s Coding identity', async variant => {
      const cache = new ValueSetCache();
      cache.setValueSetFile(`${valueSet.url}|R4`, valueSet);
      cache.setCodeSystemFile(`${codeSystem.url}|fhir4`, codeSystem);
      const resource = { resourceType: 'Condition', category: [{ coding: [{
        system: variant === 'wrong-system' ? 'https://example.test/CodeSystem/wrong' : system,
        code: variant === 'rejected' ? 'absent' : 'health-concern',
      }] }] };
      const resolver = { resolveCodeMembership: async (code: string, codingSystem: string | undefined) =>
        code === 'health-concern' && codingSystem === system ? 'valid' as const : 'invalid' as const,
      resolveSubsumption: async () => 'unknown' as const };
      const issues = implementation === 'general'
        ? await new ConstraintValidator(resolver, undefined, cache).validate(resource, definition.snapshot!.element, definition.url!)
        : await new SDFHIRPathExecutor(cache).execute({ resource, resourceType: 'Condition', structureDef: definition, terminologyResolver: resolver });
      if (variant === 'valid') expect(issues).toEqual([]);
      else {
        expect(issues).toEqual([expect.objectContaining({ severity: constraint.severity, ruleId: constraint.key })]);
        expect(issues[0].details?.validationComplete).not.toBe(false);
      }
    });
  });
});
