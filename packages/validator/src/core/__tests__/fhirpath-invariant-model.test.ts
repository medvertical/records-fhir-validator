import fhirpath from 'fhirpath';
import { describe, expect, it } from 'vitest';
import { getFhirPathModel, getInvariantFhirPathModel } from '../fhirpath-context';

// PACIO ADI's HCA-section-entries tests `resolve() is relatedPerson`.
const section = { entry: [{ reference: 'RelatedPerson/agent' }] };
const agent = { resourceType: 'RelatedPerson', id: 'agent' };
const HCA_ENTRIES = "entry.exists().not() or entry.where($this.reference = 'RelatedPerson/agent' and %agent is relatedPerson).exists()";

describe('invariant FHIRPath model', () => {
  it('tests a value against an undefined type name as against a type it is not', () => {
    expect(fhirpath.evaluate(section, HCA_ENTRIES, { agent }, getInvariantFhirPathModel('R4'))).toEqual([false]);
    expect(fhirpath.evaluate(agent, 'ofType(relatedPerson)', {}, getInvariantFhirPathModel('R4'))).toEqual([]);
  });

  it('still tells a defined type apart', () => {
    expect(fhirpath.evaluate(agent, '$this is RelatedPerson', {}, getInvariantFhirPathModel('R5'))).toEqual([true]);
  });

  it('leaves the strict model refusing the name', () => {
    expect(() => fhirpath.evaluate(section, HCA_ENTRIES, { agent }, getFhirPathModel('R4')))
      .toThrow('cannot be resolved to a valid type identifier');
  });
});
