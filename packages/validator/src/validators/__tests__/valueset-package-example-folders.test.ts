import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';

// CPG ships the code systems its examples use (chf-codes) in package/example
// only; the reference validator loads that folder with the package.
const CHF_CODES = 'http://hl7.org/fhir/uv/cpg/CodeSystem/chf-codes';
const roots: string[] = [];

async function storeWith(files: Record<string, unknown>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-example-folder-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), JSON.stringify(content));
  }
  return root;
}

const chfCodes = {
  resourceType: 'CodeSystem', url: CHF_CODES, version: '1.0.0', content: 'complete',
  concept: [{ code: 'egfr', display: 'eGFR' }],
};

describe('terminology in a package example folder', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
  });

  it('resolves a code system that only an example folder defines', async () => {
    const root = await storeWith({
      'hl7.fhir.uv.cpg#1.0.0/package/.index.json': { 'index-version': 2, files: [] },
      'hl7.fhir.uv.cpg#1.0.0/package/example/.index.json': {
        'index-version': 2,
        files: [{ filename: 'CodeSystem-chf-codes.json', resourceType: 'CodeSystem', id: 'chf-codes', url: CHF_CODES }],
      },
      'hl7.fhir.uv.cpg#1.0.0/package/example/CodeSystem-chf-codes.json': chfCodes,
    });
    const loader = new ValueSetPackageLoader(new ValueSetCache(), new ValueSetPackageResourceAccess([root]));

    await expect(loader.loadCodeSystem(CHF_CODES)).resolves.toMatchObject({ url: CHF_CODES, version: '1.0.0' });
  });

  it('prefers a package root that declares the canonical', async () => {
    const root = await storeWith({
      'hl7.fhir.uv.cpg#1.0.0/package/.index.json': {
        'index-version': 2,
        files: [{ filename: 'CodeSystem-chf-codes.json', resourceType: 'CodeSystem', id: 'chf-codes', url: CHF_CODES, version: '2.0.0' }],
      },
      'hl7.fhir.uv.cpg#1.0.0/package/CodeSystem-chf-codes.json': { ...chfCodes, version: '2.0.0' },
      'hl7.fhir.uv.cpg#1.0.0/package/example/.index.json': {
        'index-version': 2,
        files: [{ filename: 'CodeSystem-chf-codes.json', resourceType: 'CodeSystem', id: 'chf-codes', url: CHF_CODES }],
      },
      'hl7.fhir.uv.cpg#1.0.0/package/example/CodeSystem-chf-codes.json': chfCodes,
    });
    const loader = new ValueSetPackageLoader(new ValueSetCache(), new ValueSetPackageResourceAccess([root]));

    await expect(loader.loadCodeSystem(CHF_CODES)).resolves.toMatchObject({ version: '2.0.0' });
  });
});
