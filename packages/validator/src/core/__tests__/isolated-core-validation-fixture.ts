import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import type { RecordsValidatorConfig } from '../validator-engine-config.js';
import { RecordsValidator } from '../validator-engine.js';

const canonical = (type: string) => `http://hl7.org/fhir/StructureDefinition/${type}`;
const field = (path: string, type: string, extra: Partial<ElementDefinition> = {}): ElementDefinition => ({
  id: path, path, min: 0, max: '1', type: [{ code: type }], ...extra,
});
const repeat = (path: string, type: string) => field(path, type, { max: '*' });
const metadata = (type: string) => [field(`${type}.id`, 'id'), field(`${type}.meta`, 'Meta')];
const resources = new Set(['Patient', 'Organization', 'DiagnosticReport', 'Parameters', 'Bundle', 'Questionnaire', 'QuestionnaireResponse', 'Resource']);
function definition(type: string, children: ElementDefinition[]): StructureDefinition {
  return { resourceType: 'StructureDefinition', id: type, url: canonical(type), version: '4.0.1', fhirVersion: '4.0.1',
    name: type, status: 'active', kind: resources.has(type) ? 'resource' : 'complex-type', abstract: type === 'Resource', type,
    snapshot: { element: [{ id: type, path: type, min: 0, max: '*' }, ...children] } };
}

/** These profiles cover only the fields exercised by the three owning public-path tests. */
function definitions(): StructureDefinition[] {
  return [
    definition('Resource', metadata('Resource')),
    definition('Patient', [...metadata('Patient'), field('Patient.birthDate', 'date'), field('Patient.gender', 'code'),
      repeat('Patient.contained', 'Resource'), field('Patient.managingOrganization', 'Reference')]),
    definition('Organization', [...metadata('Organization'), field('Organization.name', 'string'), field('Organization.active', 'boolean')]),
    definition('DiagnosticReport', [...metadata('DiagnosticReport'), field('DiagnosticReport.status', 'code'),
      field('DiagnosticReport.code', 'CodeableConcept'), field('DiagnosticReport.effective[x]', 'dateTime',
        { type: [{ code: 'dateTime' }, { code: 'Period' }] })]),
    definition('Parameters', [...metadata('Parameters'), repeat('Parameters.parameter', 'BackboneElement'),
      field('Parameters.parameter.name', 'string'), field('Parameters.parameter.resource', 'Resource')]),
    definition('Bundle', [...metadata('Bundle'), field('Bundle.type', 'code'), repeat('Bundle.entry', 'BackboneElement'),
      field('Bundle.entry.fullUrl', 'uri'), field('Bundle.entry.resource', 'Resource'),
      field('Bundle.entry.request', 'BackboneElement'), field('Bundle.entry.request.method', 'code'), field('Bundle.entry.request.url', 'uri')]),
    definition('Questionnaire', [...metadata('Questionnaire'), field('Questionnaire.status', 'code'),
      repeat('Questionnaire.item', 'BackboneElement'), field('Questionnaire.item.linkId', 'string'),
      field('Questionnaire.item.type', 'code'), field('Questionnaire.item.text', 'string')]),
    definition('QuestionnaireResponse', [...metadata('QuestionnaireResponse'), field('QuestionnaireResponse.status', 'code'),
      field('QuestionnaireResponse.questionnaire', 'canonical'), repeat('QuestionnaireResponse.item', 'BackboneElement'),
      field('QuestionnaireResponse.item.linkId', 'string'), repeat('QuestionnaireResponse.item.answer', 'BackboneElement'),
      field('QuestionnaireResponse.item.answer.value[x]', 'string')]),
    definition('Reference', [field('Reference.reference', 'string'), field('Reference.type', 'uri'),
      field('Reference.identifier', 'Identifier'), field('Reference.display', 'string')]),
    definition('Identifier', [field('Identifier.system', 'uri'), field('Identifier.value', 'string')]),
    definition('CodeableConcept', [repeat('CodeableConcept.coding', 'Coding'), field('CodeableConcept.text', 'string')]),
    definition('Coding', [field('Coding.system', 'uri'), field('Coding.version', 'string'), field('Coding.code', 'code'), field('Coding.display', 'string')]),
    definition('Period', [field('Period.start', 'dateTime'), field('Period.end', 'dateTime')]),
    definition('Meta', [field('Meta.versionId', 'id'), field('Meta.lastUpdated', 'instant'), repeat('Meta.profile', 'canonical')]),
    definition('BackboneElement', [field('BackboneElement.id', 'string')]),
  ];
}

export async function createIsolatedCoreValidationFixture(
  options: Pick<RecordsValidatorConfig, 'enableCaching' | 'strictMode'> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'records-own-core-public-paths-'));
  const packageCachePath = join(root, 'packages'); const bundledProfilesPath = join(root, 'bundled');
  const folder = join(packageCachePath, 'hl7.fhir.r4.core#4.0.1', 'package');
  try {
    await mkdir(folder, { recursive: true }); await mkdir(bundledProfilesPath);
    const profiles = definitions();
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1', fhirVersions: ['4.0.1'] }));
    await writeFile(join(folder, '.index.json'), JSON.stringify({ 'index-version': 2, files: profiles.map(profile => ({
      filename: `StructureDefinition-${profile.type}.json`, resourceType: profile.resourceType, url: profile.url, version: profile.version,
    })) }));
    await Promise.all(profiles.map(profile => writeFile(join(folder, `StructureDefinition-${profile.type}.json`), JSON.stringify(profile))));
    const validator = new RecordsValidator({ ...options, packageCachePath, bundledProfilesPath,
      autoDownload: false, prewarmProfileSource: false, terminologyPackageDirectories: [] });
    await validator.waitForInitialization();
    for (const type of ['Patient', 'Organization', 'DiagnosticReport', 'Parameters', 'Bundle', 'Questionnaire', 'QuestionnaireResponse']) {
      expect(await validator.getSdLoader().loadProfile(canonical(type), 'R4')).toMatchObject({ type, kind: 'resource', fhirVersion: '4.0.1' });
    }
    return { validator, dispose: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true }); throw error;
  }
}

export function expectOwnCoreProfilesResolved(issues: ReadonlyArray<{ code?: ValidationIssue['code'] }>): void {
  expect(issues.filter(issue => issue.code === 'profile-not-found' || issue.code === 'profile-not-resolved')).toEqual([]);
}
