import { SlicingValidator } from '../slicing-validator.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';

export interface ResolverContract {
  id: string; mode: string; definitionType: string; targetType?: string; laterType?: string;
  verdict?: boolean; occurrences?: number; max?: string;
  expected?: Record<string, number | boolean>;
  expectedFirst?: Record<string, number | boolean>; expectedSecond?: Record<string, number | boolean>;
}

/** Synthetic conformance callbacks are explicit verifier seams, not native IG validity evidence. */
export async function exerciseResolverContract(contract: ResolverContract) {
  const url = 'https://example.test/StructureDefinition/G4Target';
  const canonical = url + '|2';
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  let phase = 0, requests: string[] = [];
  const lookups: unknown[][] = [], conforms: unknown[][] = [];
  const profile: StructureDefinition = { resourceType: 'StructureDefinition',
    url: url + '-host', name: 'Host', status: 'active', kind: 'resource', abstract: false,
    type: 'List', snapshot: { element: [
      { id: 'List', path: 'List', min: 0, max: '1' },
      { id: 'List.entry', path: 'List.entry', min: 0, max: '*', type: [{ code: 'BackboneElement' }],
        slicing: { rules: 'closed', discriminator: [{ type: 'profile', path: 'item.resolve()' }] } },
      { id: 'List.entry:A', path: 'List.entry', sliceName: 'A', min: 0, max: contract.max ?? '*' },
      { id: 'List.entry:A.item', path: 'List.entry.item', min: 1, max: '1',
        type: [{ code: 'Reference', targetProfile: [canonical] }] },
    ] } };
  validator.setTypeProfileResolver(async (requested, family, source) => {
    lookups.push([requested, family, source?.url]);
    return { resourceType: 'StructureDefinition', url, version: '2', name: 'Target', status: 'active',
      kind: 'resource', abstract: false, type: contract.definitionType,
      fhirVersion: family === 'R5' ? '5.0.0' : '4.0.1' };
  });
  const stable = { resourceType: contract.targetType };
  const resolver = (reference: string) => {
    requests.push(reference);
    if (contract.mode === 'null') return null;
    if (contract.mode === 'throw') throw new Error('Declared unavailable source');
    if (contract.mode === 'stable') return stable;
    let type = contract.targetType;
    if (contract.mode === 'changing' && requests.length > 1) type = contract.laterType;
    if (contract.mode === 'distinct' && reference.endsWith(':1')) type = 'Patient';
    if (contract.mode === 'two-invocations' && phase === 1) type = contract.laterType;
    return { resourceType: type };
  };
  const entries = Array.from({ length: contract.occurrences ?? 1 }, (_value, index) => ({
    item: { reference: contract.mode === 'distinct' ? `urn:g4:${index + 1}` : 'urn:g4:same' },
  }));
  if (contract.occurrences === 2 && contract.mode === 'clone') entries[1] = entries[0];
  const resource = { resourceType: 'List', entry: entries };
  const rows = [];
  for (phase = 0; phase < (contract.mode === 'two-invocations' ? 2 : 1); phase++) {
    requests = [];
    const family = phase === 1 ? 'R5' : 'R4';
    const issues = await validator.validateSlicing(entries, 'List.entry', profile, resolver,
      'List.entry', family, resource, 'List.entry', async (target, requested) => {
        conforms.push([phase, target.resourceType, requested]); return contract.verdict;
      });
    const detail = (issue: typeof issues[number] | undefined) =>
      issue?.details && typeof issue.details === 'object' ? issue.details : {};
    const maxima = issues.filter(issue => issue.code === 'profile-slice-max-cardinality');
    rows.push({ phase, family, issues, requests: [...requests], observed: {
      closed: issues.filter(issue => issue.code === 'profile-slice-closed-unmatched').length,
      incomplete: issues.some(issue => detail(issue).validationComplete === false),
      resolverCalls: requests.length, maxErrors: maxima.length, maxActual: detail(maxima[0]).actual,
    } });
  }
  return { id: contract.id, rows, lookups, conforms };
}
