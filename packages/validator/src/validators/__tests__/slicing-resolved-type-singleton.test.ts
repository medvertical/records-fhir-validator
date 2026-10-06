import { describe, expect, it } from 'vitest';
import contracts from '../__fixtures__/resolved-type-singleton-contracts.json';
import { SlicingValidator } from '../slicing-validator.js';
import { prepareResolvedTypeEvidence } from '../slice-resolved-type-evidence.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import type { SliceDefinition } from '../slice-types.js';

interface Contract {
  id: string; types: (string | null)[]; min: number; max?: string; family?: string;
  requestVersion: string | null; duplicate?: boolean; displayMin?: number;
  targetMetaMatches?: boolean; referenceMetaMatches?: boolean;
  definition: { type: string; version?: string; fhirVersion?: string; foreignUrl?: boolean;
    fhirVersionGetterThrows?: boolean; versionGetterThrows?: boolean } | null;
  expected: { minErrors: number; closedErrors: number; incomplete: boolean;
    minActual?: number; maxErrors?: number; maxActual?: number; upperBound?: number; childRequiredErrors?: number };
}

const url = 'https://example.test/StructureDefinition/G6Target';
function host(contract: Contract, canonical: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: url + '-host', name: 'Host', status: 'active',
    kind: 'resource', abstract: false, type: 'List', snapshot: { element: [
      { id: 'List', path: 'List', min: 0, max: '1' },
      { id: 'List.entry', path: 'List.entry', min: 0, max: '*', type: [{ code: 'BackboneElement' }],
        slicing: { rules: 'closed', discriminator: [{ type: 'type', path: 'item.resolve()' }] } },
      { id: 'List.entry:A', path: 'List.entry', sliceName: 'A', min: contract.min,
        max: contract.max ?? '*', type: [{ code: 'BackboneElement' }] },
      { id: 'List.entry:A.item', path: 'List.entry.item', min: 1, max: '1',
        type: [{ code: 'Reference', targetProfile: [canonical] }] },
      ...(contract.displayMin ? [{ id: 'List.entry:A.item.display', path: 'List.entry.item.display',
        min: contract.displayMin, max: '1', type: [{ code: 'string' }] }] : []),
    ] } };
}

function definition(contract: Contract): StructureDefinition | null {
  if (!contract.definition) return null;
  const result: StructureDefinition = { resourceType: 'StructureDefinition',
    url: contract.definition.foreignUrl ? url + '-foreign' : url, name: 'Target', status: 'active',
    kind: 'resource', abstract: false, ...contract.definition };
  if (contract.definition.fhirVersionGetterThrows) Object.defineProperty(result, 'fhirVersion', {
    get() { throw new Error('Declared publication getter'); },
  });
  if (contract.definition.versionGetterThrows) Object.defineProperty(result, 'version', {
    get() { throw new Error('Declared business getter'); },
  });
  return result;
}

describe('Request-bound singleton post-resolve TYPE evidence', () => {
  it.each(contracts as Contract[])('$id', async contract => {
    const canonical = contract.requestVersion === null ? url : `${url}|${contract.requestVersion}`;
    const profile = host(contract, canonical), selected = definition(contract);
    const entries = contract.types.map((_type, index) => ({ item: { reference: `urn:g6:${index}`,
      ...(contract.referenceMetaMatches ? { meta: { profile: [canonical] } } : {}) } }));
    if (contract.duplicate) entries[1] = entries[0];
    const resource = { resourceType: 'List', entry: entries };
    const family = contract.family === 'R5' ? 'R5' : 'R4';
    const lookups: unknown[][] = []; let conformanceCalls = 0;
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async (requested, requestFamily, source) => {
      lookups.push([requested, requestFamily, source?.url]); return selected;
    });
    const issues = await validator.validateSlicing(entries, 'List.entry', profile, reference => {
      const type = contract.types[Number(reference.split(':').at(-1))];
      return type ? { resourceType: type,
        ...(contract.targetMetaMatches ? { meta: { profile: [canonical] } } : {}) } : null;
    }, 'List.entry', family, resource, 'List.entry', async () => {
      conformanceCalls++; throw new Error('TYPE must not establish PROFILE conformance');
    });
    const minimum = issues.filter(issue => issue.code === 'profile-slice-min-cardinality');
    const maximum = issues.filter(issue => issue.code === 'profile-slice-max-cardinality');
    const details = (issue: typeof issues[number] | undefined) => typeof issue?.details === 'object'
      && issue.details !== null ? issue.details : {};
    expect({ minErrors: minimum.length,
      closedErrors: issues.filter(issue => issue.code === 'profile-slice-closed-unmatched').length,
      incomplete: issues.some(issue => details(issue).validationComplete === false),
      minActual: details(minimum[0]).actual, maxErrors: maximum.length,
      maxActual: details(maximum[0]).actual, upperBound: details(minimum[0]).cardinalityUpperBound,
      childRequiredErrors: issues.filter(issue => issue.code === 'structural-cardinality-min'
        && details(issue).relativePath === 'item.display').length,
    }).toMatchObject(contract.expected);
    expect(conformanceCalls).toBe(0);
    expect(lookups.every(([requested, requestFamily, source]) => requested === canonical
      && requestFamily === family && source === profile.url)).toBe(true);
    expect(lookups.length).toBe(contract.types.some(Boolean) ? 1 : 0);
  });

  it.each([0, 1, 2])('does not prepare opaque or mismatched scope %s', async variant => {
    const contract = contracts[0] as Contract, profile = host(contract, url);
    const slice: SliceDefinition = { sliceName: 'A', path: 'List.entry',
      min: variant === 2 ? 0 : contract.min, max: '*',
      childTypes: new Map([['item', [{ code: 'Reference', targetProfile: [variant === 1 ? url + '-foreign' : url] }]]]) };
    let lookups = 0;
    const slices = [slice];
    expect(await prepareResolvedTypeEvidence({ elements: [{ item: { reference: 'urn:g6:0' } }], slices,
      slicing: { discriminator: [{ type: 'type', path: 'item.resolve()' }] }, referenceResolver: () => ({ resourceType: 'Observation' }),
      typeProfileResolver: async () => { lookups++; return definition(contract); },
      attestedGroup: variant !== 0, profile, elementPath: 'List.entry', fhirVersion: 'R4',
    })).toBe(slices);
    expect(lookups).toBe(0);
  });
});
