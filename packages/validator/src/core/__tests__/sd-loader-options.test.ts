import { describe, expect, it, vi } from 'vitest';
import { resolveStructureDefinitionLoaderOptions } from '../sd-loader-options.js';

vi.mock('../sd-loader-bundled-path.js', () => ({
  resolveDefaultBundledProfilesPath: () => '/installed/bundled',
}));

describe('explicit bundled profile source selection', () => {
  it.each([
    { input: undefined, expected: ['/installed/bundled', '/cache'] },
    { input: null, expected: ['/cache'] },
    { input: '/custom/bundled', expected: ['/custom/bundled', '/cache'] },
  ])('uses only the selected sources for $input', ({ input, expected }) => {
    expect(resolveStructureDefinitionLoaderOptions('/cache', input).packageSources).toEqual(expected);
  });
});
