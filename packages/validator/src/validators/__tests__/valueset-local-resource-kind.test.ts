import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { ValueSetPackageLoader } from '../valueset-package-loader.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { clearPackageCanonicalIndex } from '../valueset-package-search.js';
import { CodeSystemReferenceLookupCache, validateCodeSystemReference } from '../../core/executors/terminology-code-system-reference-rules.js';

const originalSource = getProfileSource();
const roots: string[] = [];
const canonical = 'http://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_29.html';
const edition = 'ap88-kind-unit-control';
// Whole constructed resources preserve CID29 identity for kind controls, not published authority.
const valueSet = { resourceType: 'ValueSet', url: canonical, version: edition,
  name: 'Cid29KindUnitControl', status: 'active',
  compose: { include: [{ system: 'http://dicom.nema.org/resources/ontology/DCM', concept: [{ code: 'DX' }] }] } };
const metadataCodeSystem = { resourceType: 'CodeSystem', url: canonical, version: edition,
  name: 'Cid29MetadataKindUnitControl', status: 'active', content: 'not-present' };
const codingPath = 'ImagingStudy.series[0].modality';

async function store(entries: Array<{ declaredType: string; body: Record<string, unknown> }>) {
  const root = await mkdtemp(join(tmpdir(), 'records-local-kind-'));
  roots.push(root);
  const packagePath = join(root, 'cid29-kind-control#1.0.0', 'package');
  await mkdir(packagePath, { recursive: true });
  await writeFile(join(packagePath, 'package.json'), JSON.stringify({
    name: 'cid29-kind-control', version: '1.0.0', fhirVersions: ['4.0.1'],
  }));
  const files = entries.map(entry => ({ filename: `${entry.declaredType}-cid29.json`,
    resourceType: entry.declaredType, url: canonical, version: edition }));
  await writeFile(join(packagePath, '.index.json'), JSON.stringify({ 'index-version': 1, files }));
  for (const [index, entry] of entries.entries())
    await writeFile(join(packagePath, files[index].filename), JSON.stringify(entry.body));
  return root;
}

function kindIssues(validator: ValueSetValidator, referenceCache = new CodeSystemReferenceLookupCache()) {
  const lookup = validator.getDefinitionLookup();
  return validateCodeSystemReference({ system: canonical, code: 'DX' }, codingPath, 0,
    false, 'syntax', 'R4', undefined, lookup.cache, referenceCache, lookup);
}

afterEach(async () => {
  setProfileSource(originalSource);
  clearPackageCanonicalIndex();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('local selected terminology resource kind', () => {
  it('blocks a declared ValueSet whose actual saved body is a CodeSystem', async () => {
    const root = await store([{ declaredType: 'ValueSet', body: metadataCodeSystem }]);
    const access = new ValueSetPackageResourceAccess([root]);
    await expect(access.findResourceWithStatus(canonical, [], 'ValueSet', '4'))
      .resolves.toEqual({ resource: null, blocked: true });
  });

  it('does not publish a VS-kind error for that contradictory body cold or warm', async () => {
    const root = await store([{ declaredType: 'ValueSet', body: metadataCodeSystem }]);
    const loader = new ValueSetPackageLoader(new ValueSetCache(), new ValueSetPackageResourceAccess([root]));
    const validator = new ValueSetValidator(new ValueSetCache(), undefined, [root]);
    const referenceCache = new CodeSystemReferenceLookupCache();
    for (let round = 0; round < 2; round++) {
      await expect(loader.loadValueSetResource(canonical, 'R4')).resolves.toBeNull();
      expect((await kindIssues(validator, referenceCache))
        .filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
    }
  });

  it('keeps a declared CodeSystem whose saved body is a ValueSet blocked and U', async () => {
    const root = await store([{ declaredType: 'ValueSet', body: valueSet },
      { declaredType: 'CodeSystem', body: valueSet }]);
    const validator = new ValueSetValidator(new ValueSetCache(), undefined, [root]);
    const lookup = validator.getDefinitionLookup();
    const referenceCache = new CodeSystemReferenceLookupCache();
    for (let round = 0; round < 2; round++) {
      await expect(lookup.packageLoader.loadValueSetResource(canonical, 'R4')).resolves.toEqual(valueSet);
      await expect(lookup.packageLoader.loadCodeSystemOutcome(canonical, '4'))
        .resolves.toEqual({ codeSystem: null, blocked: true });
      expect((await kindIssues(validator, referenceCache))
        .filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
    }
  });

  it('retains N when a genuine selected ValueSet has successful scoped CodeSystem absence', async () => {
    const root = await store([{ declaredType: 'ValueSet', body: valueSet }]);
    const validator = new ValueSetValidator(new ValueSetCache(), undefined, [root]);
    const lookup = validator.getDefinitionLookup();
    await expect(lookup.packageLoader.loadValueSetResource(canonical, 'R4')).resolves.toEqual(valueSet);
    await expect(lookup.packageLoader.loadCodeSystemOutcome(canonical, '4'))
      .resolves.toEqual({ codeSystem: null, blocked: false });
    expect((await kindIssues(validator)).filter(issue => issue.code === 'terminology-coding-system-valueset'))
      .toEqual([expect.objectContaining({ severity: 'error', path: `${codingPath}.system` })]);
  });

  it('retains metadata CodeSystem kind P independently of unavailable membership', async () => {
    const root = await store([{ declaredType: 'ValueSet', body: valueSet },
      { declaredType: 'CodeSystem', body: metadataCodeSystem }]);
    const validator = new ValueSetValidator(new ValueSetCache(), undefined, [root]);
    const lookup = validator.getDefinitionLookup();
    await expect(lookup.packageLoader.loadValueSetResource(canonical, 'R4')).resolves.toEqual(valueSet);
    await expect(lookup.packageLoader.loadCodeSystemOutcome(canonical, '4'))
      .resolves.toEqual({ codeSystem: metadataCodeSystem, blocked: false });
    expect((await kindIssues(validator)).filter(issue => issue.code === 'terminology-coding-system-valueset')).toEqual([]);
  });
});
