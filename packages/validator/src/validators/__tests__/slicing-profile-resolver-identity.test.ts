import { describe, it, expect } from 'vitest';
import declaration from '../__fixtures__/slicing-profile-resolver-contracts.json';
import { exerciseResolverContract, type ResolverContract } from '../__fixtures__/slicing-profile-resolver-contract.js';

describe('Invocation-local post-resolve PROFILE identity', () => {
  it.each(declaration.cases as ResolverContract[])('$id', async contract => {
    const result = await exerciseResolverContract(contract);
    for (const [index, row] of result.rows.entries()) {
      expect(row.observed).toMatchObject(index === 0
        ? contract.expected ?? contract.expectedFirst ?? {} : contract.expectedSecond ?? {});
      expect(result.lookups.filter(([, family]) => family === row.family)
        .every(([canonical, , source]) => canonical === 'https://example.test/StructureDefinition/G4Target|2'
          && source === 'https://example.test/StructureDefinition/G4Target-host')).toBe(true);
    }
  });
});
