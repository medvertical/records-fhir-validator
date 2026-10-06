import { describe, expect, it } from 'vitest';
import { specialV2Concept } from '../v2-special-concepts';

const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203';

// Finland types its personal identity codes NNFIN: v2-0203's national
// identifier concept for the country, which the table itself does not list.
describe('v2-0203 national identifier codes', () => {
  it('accepts NN followed by an ISO 3166 country code', () => {
    expect(specialV2Concept(V2_0203, 'NNFIN')).toEqual({ code: 'NNFIN' });
    expect(specialV2Concept(V2_0203, 'NNCH')).toEqual({ code: 'NNCH' });
  });

  it('rejects other codes and other code systems', () => {
    expect(specialV2Concept(V2_0203, 'NNXYZ')).toBeUndefined();
    expect(specialV2Concept(V2_0203, 'NN')).toBeUndefined();
    expect(specialV2Concept('http://terminology.hl7.org/CodeSystem/v2-0131', 'NNFIN')).toBeUndefined();
  });
});
