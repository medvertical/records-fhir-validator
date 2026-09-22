import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { BestPracticeValidator, validateBestPractices } from '../../validators/best-practice-validator';
import { executeSelectedAspects } from '../multi-aspect-aspect-execution';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import { MultiAspectSessionPolicy } from '../multi-aspect-session-policy';
import type { AspectResult } from '../multi-aspect-types';

// identifier + name present so only the narrative recommendation fires
const narrativelessPatient = {
  resourceType: 'Patient',
  id: 'patient-1',
  identifier: [{ system: 'urn:example', value: '123' }],
  name: [{ family: 'Tester' }],
};

/** Code+severity is the surface both execution paths must agree on. */
function signature(issues: ValidationIssue[]): string[] {
  return issues.map(issue => `${issue.code}:${issue.severity}`).sort();
}

/** The shared mapping the server single-aspect fallback also calls. */
function sharedHelperIssues(settings: ValidationSettings | undefined): ValidationIssue[] {
  return validateBestPractices(new BestPracticeValidator(), {
    resource: narrativelessPatient,
    resourceType: 'Patient',
    profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
  }, settings);
}

/**
 * Drives the REAL structural aspect (executeSelectedAspects behind the session
 * policy runner) with a stubbed structural executor, so every issue collected
 * here originates from the best-practice branch.
 */
async function runMultiAspectStructural(
  settings: ValidationSettings | undefined,
): Promise<AspectResult | undefined> {
  const profileUrl = 'http://hl7.org/fhir/StructureDefinition/Patient';
  const collectedAspects: AspectResult[] = [];
  const throwIfStopped = (): void => {};
  const runAspect = new MultiAspectSessionPolicy(settings).createRunner({
    collectedAspects,
    fhirVersion: 'R4',
    profileUrl,
    throwIfStopped,
  });
  await executeSelectedAspects({
    deps: {
      structuralExecutor: { validate: vi.fn().mockResolvedValue([]) },
      bestPracticeValidator: new BestPracticeValidator(),
    } as unknown as MultiAspectDeps,
    selectedAspects: new Set(['structural']),
    settings,
    profileSourceContext: {},
    profileFallbackIssue: null,
    runCustomRules: false,
    context: {
      resource: narrativelessPatient,
      resourceType: 'Patient',
      profileUrl,
      fhirVersion: 'R4',
      structureDef: { resourceType: 'StructureDefinition' },
      strictMode: false,
      settings,
    } as Parameters<typeof executeSelectedAspects>[0]['context'],
    collectedAspects,
    runAspect,
    validateOne: vi.fn(),
    targetProfileValidator: {} as Parameters<typeof executeSelectedAspects>[0]['targetProfileValidator'],
    recursionDepth: 0,
    throwIfStopped,
    sdFHIRPathExecutor: {} as Parameters<typeof executeSelectedAspects>[0]['sdFHIRPathExecutor'],
  });
  return collectedAspects.find(aspect => aspect.aspect === 'structural');
}

describe('multi-aspect structural best-practice parity with the shared mapping', () => {
  it('emits dom-6 at information for default settings', async () => {
    const settings = { aspects: {} } as ValidationSettings;

    const structural = await runMultiAspectStructural(settings);

    expect(signature(structural?.issues ?? [])).toEqual(signature(sharedHelperIssues(settings)));
    expect(structural?.issues.find(issue => issue.code === 'dom-6')?.severity).toBe('information');
  });

  it('emits dom-6 at warning for bestPracticeSeverity=warning', async () => {
    const settings = { aspects: {}, bestPracticeSeverity: 'warning' } as ValidationSettings;

    const structural = await runMultiAspectStructural(settings);

    expect(signature(structural?.issues ?? [])).toEqual(signature(sharedHelperIssues(settings)));
    expect(structural?.issues.find(issue => issue.code === 'dom-6')?.severity).toBe('warning');
  });

  it('suppresses best-practice findings for enableBestPracticeChecks=false', async () => {
    const settings = { aspects: {}, enableBestPracticeChecks: false } as ValidationSettings;

    const structural = await runMultiAspectStructural(settings);

    expect(sharedHelperIssues(settings)).toHaveLength(0);
    expect(structural?.issues).toHaveLength(0);
  });
});
