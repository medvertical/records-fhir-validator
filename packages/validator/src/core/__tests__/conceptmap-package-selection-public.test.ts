import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4, type ValidationIssue } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { ValueSetPackageLoader } from '../../validators/valueset-package-loader.js';
import { clearPackageCanonicalIndex } from '../../validators/valueset-package-search.js';
import { RecordsValidator } from '../validator-engine.js';

const originalSource = getProfileSource();
const roots: string[] = [];
const canonical = 'http://hl7.org/fhir/appointmentstatus';
const edition = '4.0.1-selection-control';
const profileUrl = 'http://hl7.org/fhir/StructureDefinition/ConceptMap';

// Saved definitions are declared unit controls, not published authority editions.
const selectedCodeSystem = {
  resourceType: 'CodeSystem', url: canonical, version: edition, name: 'SelectionControl',
  status: 'active', content: 'complete', caseSensitive: true,
  concept: [{ code: 'proposed' }, { code: 'waitlist' }],
};
const selectedProfile = {
  resourceType: 'StructureDefinition', url: profileUrl, version: edition,
  name: 'ConceptMapSelectionControl', status: 'active', kind: 'resource',
  abstract: false, type: 'ConceptMap', fhirVersion: '4.0.1',
  snapshot: { element: [{ id: 'ConceptMap', path: 'ConceptMap', min: 0, max: '*' }] },
};
const controls = [
  { name: 'compound literal is N', code: 'proposed,waitlist', content: 'complete', expected: 'N' },
  { name: 'atomic proposed is P', code: 'proposed', content: 'complete', expected: 'P' },
  { name: 'atomic waitlist is P', code: 'waitlist', content: 'complete', expected: 'P' },
  { name: 'fragment cannot prove N', code: 'proposed,waitlist', content: 'fragment', expected: 'U' },
  { name: 'not-present cannot prove N', code: 'proposed,waitlist', content: 'not-present', expected: 'U' },
  { name: 'supplement cannot prove N', code: 'proposed,waitlist', content: 'supplement', expected: 'U' },
  { name: 'unavailable own edition stays U', code: 'proposed,waitlist', content: 'complete', expected: 'U', requestedVersion: '99.0.0' },
  { name: 'contradictory selected kind stays U', code: 'proposed,waitlist', content: 'complete', expected: 'U', wrongKind: true },
] as const;

afterEach(async () => {
  vi.restoreAllMocks();
  setProfileSource(originalSource);
  clearPackageCanonicalIndex();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function settings() {
  const result = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(result.aspects)) aspect.enabled = false;
  result.aspects.structural.enabled = true;
  result.aspects.terminology.enabled = true;
  result.advisorRules = [];
  result.terminologyServers = [];
  result.profileSources = { simplifier: false, packageRegistry: false };
  if (result.packageDownload) result.packageDownload.autoDownload = false;
  result.terminologyResolution = { ...result.terminologyResolution, strategy: 'local-only' };
  return result;
}

for (const api of ['single', 'multi'] as const) {
  describe(`${api} ConceptMap actual package selection`, () => {
    it.each(controls)('$name, cold and warm', async control => {
      const root = await mkdtemp(join(tmpdir(), 'records-cm-selection-'));
      roots.push(root);
      const packagePath = join(root, 'cm-selection-control#1.0.0', 'package');
      await mkdir(packagePath, { recursive: true });
      const body = 'wrongKind' in control ? {
        resourceType: 'ValueSet', url: canonical, version: edition, name: 'ContradictoryKindControl',
        status: 'active', compose: { include: [{ system: canonical, concept: [{ code: 'proposed' }] }] },
      } : { ...selectedCodeSystem, content: control.content };
      await writeFile(join(packagePath, 'package.json'), JSON.stringify({
        name: 'cm-selection-control', version: '1.0.0', fhirVersions: ['4.0.1'],
      }));
      await writeFile(join(packagePath, '.index.json'), JSON.stringify({ 'index-version': 1,
        files: [{ filename: 'CodeSystem-appointmentstatus.json', resourceType: 'CodeSystem',
          url: canonical, version: edition }] }));
      await writeFile(join(packagePath, 'CodeSystem-appointmentstatus.json'), JSON.stringify(body));
      setProfileSource({ packageDirectories: [root] });
      const validator = new RecordsValidator({
        packageCachePath: join(root, 'empty-profile-cache'), bundledProfilesPath: null,
        autoDownload: false, prewarmProfileSource: false, enableCaching: false, timeout: 30_000,
      });
      await validator.waitForInitialization();
      expect(validator.getSdLoader().registerExternalProfile(selectedProfile, 'R4')).toBe(true);
      const codeSystemRead = vi.spyOn(ValueSetPackageLoader.prototype, 'loadCodeSystem');
      const requestedVersion = 'requestedVersion' in control ? control.requestedVersion : edition;
      const resource = { resourceType: 'ConceptMap', status: 'active', group: [{
        source: canonical, sourceVersion: requestedVersion, target: canonical, targetVersion: requestedVersion,
        element: [{ code: control.code, target: [{ code: 'proposed', equivalence: 'equal' }] }],
      }] };
      for (let round = 0; round < 2; round++) {
        codeSystemRead.mockClear();
        let issues: ValidationIssue[];
        if (api === 'single') issues = await validator.validate(resource, profileUrl, 'R4', settings());
        else {
          const batch = await validator.validateBatch([resource], { fhirVersion: 'R4', profileUrl,
            maxConcurrency: 1, aspects: ['structural', 'terminology'], settings: settings() });
          const result = batch.get(resource);
          expect(result).toBeDefined();
          issues = result && 'aspects' in result ? result.aspects.flatMap(aspect => aspect.issues) : [];
        }
        expect(issues.some(issue => issue.code === 'profile-not-resolved')).toBe(false);
        const selectedReads = codeSystemRead.mock.calls.flatMap((call, index) =>
          call[0] === canonical && call[2] === requestedVersion ? [index] : []);
        const unavailable = 'wrongKind' in control || 'requestedVersion' in control;
        expect(selectedReads).toHaveLength(unavailable ? 2 : 1);
        for (const index of selectedReads) {
          const selected = await codeSystemRead.mock.results[index].value;
          if (unavailable) expect(selected).toBeNull();
          else expect(selected).toEqual(body);
        }
        const codeIssues = issues.filter(issue => issue.code === 'tx-conceptmap-source-code-invalid');
        if (control.expected === 'N') expect(codeIssues).toEqual([expect.objectContaining({
          severity: 'error', aspect: 'structural', resourceType: 'ConceptMap',
          validationMethod: 'structural-validation', path: 'ConceptMap.group[0].element[0].code',
          message: `The source code 'proposed,waitlist' is not valid in the code system ${canonical}|${edition}`,
        })]);
        else expect(codeIssues).toEqual([]);
      }
    // Setup and two public calls each retain the validator's own 30-second budget.
    }, 90_000);
  });
}
