import { describe, expect, it } from 'vitest';
import { referencesWithoutDisplay } from '../reference-display-rules';

describe('referencesWithoutDisplay', () => {
  it('warns about a Reference that names nothing and says nothing', () => {
    expect(referencesWithoutDisplay([{ type: 'Practitioner' }, { display: 'Dr X' }], 'Observation.performer'))
      .toEqual([expect.objectContaining({
        code: 'reference-without-display',
        path: 'Observation.performer[0]',
        severity: 'warning',
      })]);
  });

  it('accepts a reference or an identifier without a display', () => {
    expect(referencesWithoutDisplay({ reference: 'Patient/1' }, 'Observation.subject')).toEqual([]);
    expect(referencesWithoutDisplay({ identifier: { value: '1' } }, 'Observation.subject')).toEqual([]);
  });

  it('leaves pattern values in ElementDefinitions alone', () => {
    expect(referencesWithoutDisplay({}, 'StructureDefinition.snapshot.element[3].patternReference')).toEqual([]);
  });
});
