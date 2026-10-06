import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';

const RESOURCE_TYPES = 'http://hl7.org/fhir/resource-types';
const THO_SYSTEM = 'http://terminology.hl7.org/CodeSystem/audit-entity-type';

describe('core-namespace CodeSystems belong to their release', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
  });

  async function loaderWithR4Core(): Promise<ValueSetPackageLoader> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-core-release-'));
    roots.push(root);
    const packageDir = path.join(root, 'hl7.fhir.r4.core#4.0.1', 'package');
    await fs.mkdir(packageDir, { recursive: true });
    const codeSystem = (url: string, version: string, code: string) => JSON.stringify({
      resourceType: 'CodeSystem', url, version, status: 'active', content: 'complete', concept: [{ code }],
    });
    await fs.writeFile(path.join(packageDir, 'CodeSystem-resource-types.json'), codeSystem(RESOURCE_TYPES, '4.0.1', 'Patient'));
    await fs.writeFile(path.join(packageDir, 'CodeSystem-audit-entity-type.json'), codeSystem(THO_SYSTEM, '4.0.1', '2'));
    return new ValueSetPackageLoader(new ValueSetCache(), new ValueSetPackageResourceAccess([root]));
  }

  it('does not let R5 validation use a core system only R4 defines', async () => {
    const loader = await loaderWithR4Core();

    await expect(loader.loadCodeSystem(RESOURCE_TYPES, '5')).resolves.toBeNull();
    await expect(loader.loadCodeSystem(RESOURCE_TYPES, '4')).resolves.toMatchObject({ url: RESOURCE_TYPES });
  });

  it('keeps HL7 Terminology systems usable across releases', async () => {
    const loader = await loaderWithR4Core();

    await expect(loader.loadCodeSystem(THO_SYSTEM, '5')).resolves.toMatchObject({ url: THO_SYSTEM });
  });
});
