import { describe, expect, it } from 'vitest';
import { qualityRuleDefinitionSchema } from '../quality-rule-pack.js';

const rule = { id: 'synthetic-population', title: 'Synthetic population', category: 'completeness', scope: 'cohort',
  severity: 'information', normativeStatus: 'informative', source: { label: 'Synthetic fixture' },
  applicability: { resourceTypes: ['Observation'], fhirVersions: ['R4'], profilesAny: [] },
  implementation: { kind: 'cohort-rate', numeratorExpression: 'true' } };

describe('optional DQA profile population selection', () => {
  it.each(['include-prefix', 'include-exact', 'exclude-prefix'])('retains explicit %s semantics without version normalization', mode => {
    const profileSelection = { mode, canonicals: ['https://example.org/profile'] };
    const parsed = qualityRuleDefinitionSchema.parse({ ...rule, applicability: { ...rule.applicability, profileSelection } });
    expect(parsed.applicability).toHaveProperty('profileSelection', profileSelection);
  });
  it('does not add a selection to an existing manifest', () => {
    expect(qualityRuleDefinitionSchema.parse(rule).applicability).not.toHaveProperty('profileSelection');
  });
  it.each([
    { mode: 'unknown', canonicals: ['https://example.org/profile'] }, { mode: 'include-prefix', canonicals: [] },
    { mode: 'include-prefix', canonicals: ['not-a-url'] },
    { mode: 'include-prefix', canonicals: ['https://example.org/profile', 'https://example.org/profile'] },
    { mode: 'include-prefix', canonicals: ['https://example.org/profile'], unreviewed: true },
    { mode: 'include-prefix', canonicals: Array.from({ length: 65 }, (_, index) => `https://example.org/${index}`) },
  ])('rejects ambiguous or unbounded selection %#', profileSelection => {
    expect(qualityRuleDefinitionSchema.safeParse({ ...rule, applicability: { ...rule.applicability, profileSelection } }).success).toBe(false);
  });
});
