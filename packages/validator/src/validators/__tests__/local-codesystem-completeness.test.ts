import { describe, expect, it, vi } from 'vitest';
import { ValueSetCache } from '../valueset-cache.js';
import { validateCodeInLocalCodeSystem } from '../valueset-local-code-system-validation.js';
import type { CodeSystem } from '../valueset-types.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import type { ValueSetPackageLoader } from '../valueset-package-loader.js';

const system = 'https://records.test/CodeSystem/partial-content';
const contents: CodeSystem['content'][] = ['complete', 'fragment', 'example', undefined];
function deps(content: CodeSystem['content']) {
  const cache = new ValueSetCache();
  cache.setCodeSystem(system, { resourceType: 'CodeSystem', url: system, version: '1.0.0',
    ...(content ? { content } : {}), concept: [{ code: 'known', display: 'Known' }] });
  return { cache, packageLoader: { loadCodeSystem: vi.fn(async () => null) } as unknown as ValueSetPackageLoader };
}

describe('local CodeSystem completeness', () => {
  it.each(contents)('preserves a listed positive member under %s', async content => {
    const result = await validateCodeInLocalCodeSystem(deps(content), 'known', system, 'Known');
    expect(result).toMatchObject({ valid: true });
    expect(buildCodeSystemResultIssues({ system, code: 'known' }, result!, 'Observation.code.coding', 0, true)).toEqual([]);
  });

  it.each(['fragment', 'example', undefined] as const)('does not prove an absent concept invalid under %s', async content => {
    const result = await validateCodeInLocalCodeSystem(deps(content), 'not-listed', system);
    expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: true });
    const issues = buildCodeSystemResultIssues({ system, code: 'not-listed' }, result!, 'Observation.code.coding', 0, true);
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning', details: expect.objectContaining({ validationComplete: false }) })]);
    expect(issues.some(issue => issue.severity === 'error')).toBe(false);
  });

  it('retains authoritative rejection from a complete definition', async () => {
    const result = await validateCodeInLocalCodeSystem(deps('complete'), 'not-listed', system);
    expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: false });
    const issues = buildCodeSystemResultIssues({ system, code: 'not-listed' }, result!, 'Observation.code.coding', 0, true);
    expect(issues).toEqual([expect.objectContaining({ severity: 'error' })]);
    expect(issues[0].details).not.toHaveProperty('validationComplete');
  });

  it.each([['https://records.test/compositional', true], ['http://unitsofmeasure.org', false]] as const)(
    'does not reject unlisted grammar expressions for %s', async (url, compositional) => {
      const dependencies = deps('complete');
      dependencies.cache.setCodeSystem(url, { resourceType: 'CodeSystem', url, content: 'complete',
        compositional, count: 1, concept: [{ code: 'known', display: 'Known' }] });
      expect(await validateCodeInLocalCodeSystem(dependencies, 'known', url)).toMatchObject({ valid: true });
      const result = await validateCodeInLocalCodeSystem(dependencies, 'known+other', url);
      expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: true });
      const issues = buildCodeSystemResultIssues({ system: url, code: 'known+other' }, result!, 'Observation.code', 0, false);
      expect(issues).toEqual([expect.objectContaining({ severity: 'warning',
        details: expect.objectContaining({ validationComplete: false }) })]);
    },
  );
});
