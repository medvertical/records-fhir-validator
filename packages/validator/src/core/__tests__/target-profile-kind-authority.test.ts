import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { RecordsValidator } from '../validator-engine.js';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context.js';
import { lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance.js';
import { setProfileSource } from '../../persistence/profile-source.js';

// Separate NEW verification of actual selected target kind; no reconstructed original-input claim.
const roots: string[] = [];
const targetUrl = 'https://example.test/StructureDefinition/DependentPatient';
const baseUrl = 'https://example.test/StructureDefinition/BasePatient';
const childUrl = 'https://example.test/StructureDefinition/ChildPatient';
const element = (id: string, extra: Partial<ElementDefinition> = {}): ElementDefinition => ({ id, path: id, ...extra });
const definition = (url: string, min: number, differential = false): StructureDefinition => {
  const elements = [element('Patient', { min: 0, max: '*' }),
    element('Patient.active', { min, max: '1', type: [{ code: 'boolean' }] })];
  return { resourceType: 'StructureDefinition', id: url.split('/').pop()!, url,
    version: '7.0.0', fhirVersion: '4.0.1', name: 'PatientProfile', status: 'active', abstract: false,
    kind: 'resource', type: 'Patient', derivation: 'constraint',
    baseDefinition: differential ? targetUrl : 'http://hl7.org/fhir/StructureDefinition/Patient',
    ...(differential ? { differential: { element: [elements[0]] } } : { snapshot: { element: elements } }) };
};
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'records-new-profile-contract-')); roots.push(root);
  const writePackage = async (name: string, version: string, definitions: StructureDefinition[],
    dependencies: Record<string, string> = {}, fhirVersions = ['4.0.1']) => {
    const directory = join(root, `${name}#${version}`, 'package'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, fhirVersions, dependencies }));
    await writeFile(join(directory, '.index.json'), JSON.stringify({ 'index-version': 2, files: definitions.map((sd, index) => ({
      filename: `StructureDefinition-${index}.json`, resourceType: sd.resourceType, url: sd.url, version: sd.version,
    })) }));
    await Promise.all(definitions.map((sd, index) => writeFile(join(directory, `StructureDefinition-${index}.json`), JSON.stringify(sd))));
  };
  await writePackage('hl7.fhir.r4.core', '4.0.1', [
    { ...definition('http://hl7.org/fhir/StructureDefinition/Patient', 0), version: '4.0.1' },
    { ...definition('http://hl7.org/fhir/StructureDefinition/Observation', 0), version: '4.0.1', type: 'Observation', baseDefinition: undefined,
      snapshot: { element: [element('Observation')] } },
  ]);
  return { root, writePackage };
}
async function validatorFor(root: string) {
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
    prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
  await validator.waitForInitialization(); return validator;
}
function settingsFor() {
  const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  settings.profileSources = { simplifier: false, packageRegistry: false };
  settings.terminologyServers = []; settings.advisorRules = [];
  settings.aspects.reference.enabled = true; settings.aspects.custom_rule.enabled = false;
  return settings;
}
async function validate(validator: RecordsValidator, api: 'single' | 'multi', resource: Record<string, unknown>,
  profile: string, settings = settingsFor()): Promise<ValidationIssue[]> {
  return api === 'single' ? validator.validate(resource, `${profile}|7.0.0`, 'R4', settings)
    : (await validator.validateAspects(resource, { aspects: ['structural', 'profile', 'reference'], settings,
      fhirVersion: 'R4', profileUrl: `${profile}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
}
const incomplete = (issues: ValidationIssue[]) => issues.some(issue => issue.details?.validationComplete === false);


const observationPath = process.env.RECORDS_TARGET_KIND_OBSERVATIONS;
if (observationPath && !observationPath.startsWith('/private/tmp/')) throw new Error('Use a fresh private observation path');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sdMetadata = (sd: { url?: string; version?: string } | null | undefined) => sd && ({
  canonical: sd.url, businessVersion: sd.version, origin: lookupProfilePackageProvenance(sd),
  ownType: 'type' in sd ? sd.type : undefined, objectSha256: digest(sd),
});

describe('NEW package-bound target kind public countercontrols', () => {
  it.each(['single', 'multi'] as const)('uses each actual selected target SD.type through %s', async api => {
    for (const mode of ['inherited', 'override'] as const) {
      const { root, writePackage } = await store();
      const typedTarget = (type: 'Patient' | 'Practitioner'): StructureDefinition => ({
        ...definition(targetUrl, 0), type, baseDefinition: `http://hl7.org/fhir/StructureDefinition/${type}`,
        snapshot: { element: [element(type, { min: 0, max: '*' }),
          element(`${type}.active`, { min: 0, max: '1', type: [{ code: 'boolean' }] })] },
      });
      await writePackage('hl7.fhir.r4.core', '4.0.1', [
        { ...definition('http://hl7.org/fhir/StructureDefinition/Patient', 0), version: '4.0.1' },
        { ...typedTarget('Practitioner'), url: 'http://hl7.org/fhir/StructureDefinition/Practitioner', version: '4.0.1' },
        { ...definition('http://hl7.org/fhir/StructureDefinition/Observation', 0), version: '4.0.1', type: 'Observation', baseDefinition: undefined,
          snapshot: { element: [element('Observation', { min: 0, max: '*' })] } },
      ]);
      await writePackage('example.target', '1.0.0', [typedTarget('Patient')]);
      await writePackage('example.target', '2.0.0', [typedTarget('Practitioner')]);
      const base: StructureDefinition = { ...definition(baseUrl, 0), type: 'Observation',
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation',
        snapshot: { element: [element('Observation', { min: 0, max: '*' }), element('Observation.subject', {
          min: 1, max: '1', type: [{ code: 'Reference', targetProfile: [targetUrl] }],
        })] } };
      await writePackage('example.base', '1.0.0', [base], { 'example.target': '1.0.0' });
      const child: StructureDefinition = { ...base, url: childUrl, id: 'ChildPatient', snapshot: undefined, baseDefinition: baseUrl,
        differential: { element: [element('Observation'), element('Observation.subject', {
          mustSupport: true, ...(mode === 'override' ? { type: [{ code: 'Reference', targetProfile: [targetUrl] }] } : {}),
        })] } };
      await writePackage('example.child', '1.0.0', [child], { 'example.base': '1.0.0', 'example.target': '2.0.0' });
      const validator = await validatorFor(root); const loader = validator.getSdLoader();
      const original = loader.loadReferencedProfile.bind(loader);
      const receipts: Record<string, unknown>[] = [];
      vi.spyOn(loader, 'loadReferencedProfile').mockImplementation(async (...args) => {
        try {
          const result = await original(...args);
          if (args[0] === targetUrl) receipts.push({ suppliedDefiner: sdMetadata(args[1]), returned: sdMetadata(result), requestFHIR: args[2] });
          return result;
        } catch (error: unknown) {
          if (args[0] === targetUrl) receipts.push({ suppliedDefiner: sdMetadata(args[1]), error: error instanceof Error ? error.name : 'unknown' });
          throw error;
        }
      });
      const declaredType = mode === 'inherited' ? 'Patient' : 'Practitioner';
      for (const actualType of ['Patient', 'Practitioner'] as const) {
        receipts.length = 0;
        const resource = { resourceType: 'Observation', contained: [{ resourceType: actualType, id: 'own-target', active: true }],
          subject: { reference: '#own-target' } };
        const issues = await validate(validator, api, resource, childUrl);
        if (observationPath) await appendFile(observationPath, JSON.stringify({ api, mode, declaredType, actualType,
          inputSha256: digest(resource), receipts: [...receipts], issues: issues.map(issue => ({ code: issue.code,
            severity: issue.severity, path: issue.path, validationComplete: issue.details?.validationComplete,
            cause: issue.details?.cause, messageSha256: digest(issue.message) })) }) + '\n');
        expect(issues.some(issue => issue.code === 'reference-target-type-invalid')).toBe(actualType !== declaredType);
        expect(incomplete(issues)).toBe(false);
        if (actualType === declaredType) expect(issues.some(issue => issue.code === 'reference-target-profile-noncompliant')).toBe(false);
      }
      vi.restoreAllMocks();
    }
  });
});
