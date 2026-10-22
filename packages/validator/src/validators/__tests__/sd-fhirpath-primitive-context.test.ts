import { describe, expect, it } from 'vitest';
import type { Constraint, StructureDefinition } from '../../core/structure-definition-types.js';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor.js';
import { SDFHIRPathConstraintEvaluator } from '../sd-fhirpath-constraint-evaluator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ConstraintValidator } from '../constraint-validator.js';

const iso = 'http://hl7.org/fhir/StructureDefinition/iso21090-codedString';
const alternative = 'https://gematik.de/fhir/vsdm2/StructureDefinition/VSDMISO3166Ergaenzung';
const constraint: Constraint = {
  key: 'country-code-iso-or-extension-1', severity: 'error', human: 'Exactly one country coding',
  expression: `extension.where(url = '${iso}').exists() != extension.where(url = '${alternative}').exists()`,
};

function profile(resourceType: string, rule = constraint, path = `${resourceType}.address.country`): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'https://example.org/primitive-context',
    name: 'PrimitiveContext', status: 'active', kind: 'resource', abstract: false, type: resourceType,
    snapshot: { element: [{ id: resourceType, path: resourceType }, {
      id: path, path, type: [{ code: 'string' }], constraint: [rule],
    }] },
  };
}

describe('primitive invariant contexts', () => {
  it.each(['Patient', 'Organization'])('checks the original VSDM country XOR on %s', async resourceType => {
    for (const urls of [[iso], [alternative], [], [iso, alternative]]) {
      const resource = { resourceType, address: [{ country: 'Deutschland',
        _country: { extension: urls.map(url => ({ url, valueCoding: { code: 'DE' } })) },
      }] };
      const before = JSON.stringify(resource);
      const issues = await new SDFHIRPathExecutor().execute({ resource, resourceType, structureDef: profile(resourceType) });
      expect(issues.filter(issue => issue.ruleId === constraint.key)).toHaveLength(urls.length === 1 ? 0 : 1);
      expect(JSON.stringify(resource)).toBe(before);
    }
  });

  it('preserves scalar semantics alongside extension access', async () => {
    const rule = { ...constraint, expression: "hasValue() and $this = 'Deutschland' and ($this is FHIR.string) and extension.exists()" };
    const issues = await new SDFHIRPathExecutor().execute({
      resource: { resourceType: 'Patient', address: [{ country: 'Deutschland', _country: { extension: [{ url: iso }] } }] },
      resourceType: 'Patient', structureDef: profile('Patient', rule),
    });
    expect(issues).toEqual([]);
  });

  it('keeps array sidecars aligned across null slots', async () => {
    const rule = { ...constraint, expression: "($this = 'C') = extension.exists()" };
    const issues = await new SDFHIRPathExecutor().execute({
      resource: { resourceType: 'Patient', name: [{ given: ['A', null, 'C'], _given: [null, null, { extension: [{ url: iso }] }] }] },
      resourceType: 'Patient', structureDef: profile('Patient', rule, 'Patient.name.given'),
    });
    expect(issues).toEqual([]);
  });

  it('preserves metadata for collected element constraints too', async () => {
    const resource = { resourceType: 'Patient', address: [{ country: 'Deutschland', _country: { extension: [{ url: iso }] } }] };
    const issues = await new SDFHIRPathConstraintEvaluator(new ValueSetCache()).evaluateCollectedConstraint({
      constraint, elementPath: 'Patient.address.country', elementTypes: ['string'], isRootConstraint: false, minCardinality: 0,
    }, { resource, rootResource: resource, resourceType: 'Patient', fhirVersion: 'R4', userInvocationTable: {} });
    expect(issues).toEqual([]);
  });

  it('retains extension-only primitives and does not invent a scalar value', async () => {
    const rule = { ...constraint, expression: 'hasValue().not() and extension.exists()' };
    const issues = await new SDFHIRPathExecutor().execute({
      resource: { resourceType: 'Patient', address: [{ _country: { extension: [{ url: iso }] } }] },
      resourceType: 'Patient', structureDef: profile('Patient', rule),
    });
    expect(issues).toEqual([]);
  });

  it('evaluates extension-only array slots at their original index', async () => {
    const rule = { ...constraint, expression: 'hasValue()' };
    const issues = await new SDFHIRPathExecutor().execute({
      resource: { resourceType: 'Patient', name: [{
        given: ['A', null, 'C'], _given: [null, { extension: [{ url: iso }] }, null],
      }] },
      resourceType: 'Patient', structureDef: profile('Patient', rule, 'Patient.name.given'),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('Patient.name[0].given[1]');
  });

  it('retains primitive metadata in the slice-aware constraint validator', async () => {
    const sd = profile('Patient');
    const issues = await new ConstraintValidator().validate({
      resourceType: 'Patient', address: [{ country: 'Deutschland', _country: { extension: [{ url: iso }] } }],
    }, sd.snapshot!.element, sd.url);
    expect(issues).toEqual([]);
  });
});
