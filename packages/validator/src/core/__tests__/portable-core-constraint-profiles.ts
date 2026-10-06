import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { RecordsValidator } from '../validator-engine.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { narrativeConstraint, patientDefinition } from './patient-narrative-fixtures.js';

const canonical = (type: string) => `http://hl7.org/fhir/StructureDefinition/${type}`;
function definition(type: string, elements: ElementDefinition[] = [], release: 'R4' | 'R5' = 'R4'): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: canonical(type), name: `Synthetic${type}`,
    status: 'active', kind: 'resource', abstract: false, type,
    version: release === 'R4' ? '4.0.1' : '5.0.0', fhirVersion: release === 'R4' ? '4.0.1' : '5.0.0',
    snapshot: { element: [{ id: type, path: type, min: 0, max: '*', ...elements.find(element => element.path === type) },
      ...elements.filter(element => element.path !== type)] },
  };
}

// These are test-owned constraint models; no installed core catalog is copied.
export function declaredProfileDefinitions(): StructureDefinition[] {
  const elements: ElementDefinition[] = [
    { id: 'Observation.status', path: 'Observation.status', min: 0, max: '1', type: [{ code: 'code' }] },
    { id: 'Observation.category', path: 'Observation.category', min: 0, max: '*', type: [{ code: 'CodeableConcept' }] },
    { id: 'Observation.value[x]', path: 'Observation.value[x]', min: 0, max: '1', type: [{ code: 'Quantity' }] },
  ];
  const base = definition('Observation', elements);
  const imposed = definition('Observation', elements.map(element => element.path === 'Observation.category' ? { ...element, min: 1 } : element));
  imposed.url = canonical('bodyweight'); imposed.name = 'SyntheticBodyWeight';
  imposed.baseDefinition = base.url; imposed.derivation = 'constraint';
  return [base, imposed];
}

export function invariantFixerDefinitions(): StructureDefinition[] {
  return [
    definition('RiskAssessment', [
      { id: 'RiskAssessment.prediction', path: 'RiskAssessment.prediction', min: 0, max: '*', type: [{ code: 'BackboneElement' }],
        constraint: [{ key: 'ras-2', severity: 'error', human: 'Synthetic probability must not exceed 100',
          expression: 'probability is decimal implies (probability as decimal) <= 100' }] },
      { id: 'RiskAssessment.prediction.probability[x]', path: 'RiskAssessment.prediction.probability[x]', min: 0, max: '1', type: [{ code: 'decimal' }] },
    ]),
    definition('Questionnaire', [
      { id: 'Questionnaire.item', path: 'Questionnaire.item', min: 0, max: '*', type: [{ code: 'BackboneElement' }],
        constraint: [{ key: 'que-12', severity: 'error', human: 'Synthetic multiple conditions require enableBehavior',
          expression: 'enableWhen.count() > 2 implies enableBehavior.exists()' }] },
      { id: 'Questionnaire.item.enableWhen', path: 'Questionnaire.item.enableWhen', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
      { id: 'Questionnaire.item.enableBehavior', path: 'Questionnaire.item.enableBehavior', min: 0, max: '1', type: [{ code: 'code' }] },
    ]),
  ];
}

export function narrativePublicationDefinitions(): StructureDefinition[] {
  return (['R4', 'R5'] as const).flatMap(release => [
    { ...patientDefinition(release), version: release === 'R4' ? '4.0.1' : '5.0.0' },
    ...['Condition', 'Observation'].map(type => definition(type, [
      { id: type, path: type, constraint: [{ ...narrativeConstraint }] },
    ], release)),
    definition('Bundle', [
      { id: 'Bundle.type', path: 'Bundle.type', min: 0, max: '1', type: [{ code: 'code' }] },
      { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
      { id: 'Bundle.entry.fullUrl', path: 'Bundle.entry.fullUrl', min: 0, max: '1', type: [{ code: 'uri' }] },
      { id: 'Bundle.entry.resource', path: 'Bundle.entry.resource', min: 0, max: '1', type: [{ code: 'Resource' }] },
    ], release),
  ]);
}

export async function createIsolatedConstraintStore(definitions: StructureDefinition[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'records-portable-constraint-profiles-'));
  try {
    for (const version of ['4.0.1', '5.0.0']) {
      const profiles = definitions.filter(profile => profile.fhirVersion === version);
      if (profiles.length === 0) continue;
      const name = version === '5.0.0' ? 'hl7.fhir.r5.core' : 'hl7.fhir.r4.core';
      const directory = join(root, `${name}#${version}`, 'package');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, fhirVersions: [version] }));
      const files = profiles.map(profile => ({
        filename: `StructureDefinition-${profile.url.slice(profile.url.lastIndexOf('/') + 1)}.json`,
        resourceType: profile.resourceType, url: profile.url, version: profile.version,
      }));
      await writeFile(join(directory, '.index.json'), JSON.stringify({ 'index-version': 2, files }));
      for (const [index, profile] of profiles.entries()) {
        await writeFile(join(directory, files[index].filename), JSON.stringify(profile));
      }
    }
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true }); throw error;
  }
}
export async function removeIsolatedConstraintStore(root: string | undefined): Promise<void> {
  if (root) await rm(root, { recursive: true, force: true });
}

export async function expectIsolatedConstraintProfilesLoaded(validator: RecordsValidator, definitions: StructureDefinition[]): Promise<void> {
  for (const profile of definitions) {
    const release = profile.fhirVersion === '5.0.0' ? 'R5' : 'R4';
    const loaded = await validator.getSdLoader().loadProfile(profile.url, release);
    expect(loaded, `Synthetic own ${profile.url} ${release} must resolve before behavior assertions`).toMatchObject({
      url: profile.url, version: profile.version, type: profile.type, fhirVersion: profile.fhirVersion,
    });
    expect(loaded?.snapshot).toEqual(profile.snapshot);
  }
}
