import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ValueSetCache } from '../../../validators/valueset-cache.js';
import { ValueSetValidator } from '../../../validators/valueset-validator.js';
import { validateExternalCodeSystems, validateLocalCodeSystemCoding } from '../terminology-external-code-system-rules.js';
import { validateDeepLocalCodings } from '../terminology-local-coding-rules.js';

const directory = mkdtempSync(join(tmpdir(), 'configured-package-lookup-'));
const configured = join(directory, 'configured');
const contrary = join(directory, 'contrary');
const priorBundledPath = process.env.RECORDS_BUNDLED_PROFILES_PATH;
const system = 'http://hl7.org/fhir/us/physical-activity/CodeSystem/pa-temporary-codes';
const coding = { system, code: 'PhysicalActivity' };

function store(base: string, resource: Record<string, unknown>): void {
  const packagePath = join(base, 'hl7.fhir.us.physical-activity#1.0.0', 'package');
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(join(packagePath, 'package.json'), JSON.stringify({ name: 'hl7.fhir.us.physical-activity', version: '1.0.0', fhirVersions: ['4.0.1'] }));
  writeFileSync(join(packagePath, `${resource.resourceType}-contrary.json`), JSON.stringify(resource));
}

afterAll(() => {
  if (priorBundledPath === undefined) delete process.env.RECORDS_BUNDLED_PROFILES_PATH;
  else process.env.RECORDS_BUNDLED_PROFILES_PATH = priorBundledPath;
  rmSync(directory, { recursive: true, force: true });
});

describe('configured terminology package lookup', () => {
  it('keeps reference, unavailable-edition and meta consumers on the facade stores despite a contradictory default ValueSet', async () => {
    store(configured, { resourceType: 'CodeSystem', url: system, version: '1.0.0', status: 'active', content: 'complete', concept: [{ code: coding.code }] });
    store(contrary, { resourceType: 'ValueSet', id: 'contradictory-default', url: system, status: 'active', compose: { include: [{ system: 'urn:synthetic:wrong' }] } });
    process.env.RECORDS_BUNDLED_PROFILES_PATH = contrary;
    const facade = new ValueSetValidator(new ValueSetCache(), undefined, [configured]);
    facade.setResolutionConfig({ strategy: 'local-only', servers: [] });

    const external = await validateExternalCodeSystems(coding, 'Parameters.parameter[0].valueCoding', facade, 'R4');
    const unavailable = await validateLocalCodeSystemCoding({ ...coding, version: '99.0.0' }, 'Parameters.parameter[0].valueCoding', facade, 'R4');
    const meta = await validateDeepLocalCodings({ resourceType: 'Parameters', meta: { tag: [coding] } }, [], facade, 'R4');
    expect(external).toEqual([]);
    expect(unavailable).toContainEqual(expect.objectContaining({
      code: 'terminology-codesystem-unverified',
      details: expect.objectContaining({ validationComplete: false, codeSystemVersion: '99.0.0' }),
    }));
    expect(meta).toEqual([]);
    expect(facade.getDefinitionLookup().packageLoader.getPackageDirectories()).toEqual([configured]);
  });
});
