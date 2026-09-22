import { describe, expect, it } from 'vitest';
import {
  buildSnapshotIndex,
  detectUnknownProperties,
  makeWalkerDeps,
} from './unknown-property-walker';
import type { StructureDefinitionLoader } from '../structure-definition-loader';

/** A profile that lists only `Patient.name`, so `gender` falls through to the base check. */
const profileIndex = buildSnapshotIndex({
  resourceType: 'StructureDefinition',
  url: 'http://example.org/StructureDefinition/Slim',
  name: 'Slim', status: 'active', kind: 'resource', abstract: false, type: 'Patient',
  snapshot: { element: [{ path: 'Patient' }, { path: 'Patient.name' }] },
});

const resource = { resourceType: 'Patient', name: [{ family: 'Doe' }], gender: 'other' };

function depsWith(loadProfile: () => Promise<unknown>) {
  return makeWalkerDeps({ loadProfile } as unknown as StructureDefinitionLoader, 'R4');
}

const baseWithGender = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/Patient',
  snapshot: { element: [{ path: 'Patient' }, { path: 'Patient.name' }, { path: 'Patient.gender' }] },
};

describe('unknown-element reporting when the base definition cannot be loaded', () => {
  it('does not invent an unknown-element error on a loader failure', async () => {
    const issues = await detectUnknownProperties(
      resource, profileIndex, 'Patient', 'http://example.org/StructureDefinition/Slim',
      depsWith(() => Promise.reject(new Error('store unreadable'))),
    );

    expect(issues.map(issue => issue.code)).not.toContain('structural-unknown-element');
  });

  it('says instead that the check could not be completed', async () => {
    const issues = await detectUnknownProperties(
      resource, profileIndex, 'Patient', 'http://example.org/StructureDefinition/Slim',
      depsWith(() => Promise.reject(new Error('boom'))),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'profile-unreadable',
      severity: 'warning',
      details: { validationStatus: 'incomplete', reason: 'base-definition' },
    });
  });

  it('still accepts a property the base definition does list', async () => {
    const issues = await detectUnknownProperties(
      resource, profileIndex, 'Patient', 'http://example.org/StructureDefinition/Slim',
      depsWith(() => Promise.resolve(baseWithGender)),
    );

    expect(issues).toEqual([]);
  });

  it('still reports a property that is in neither the profile nor the base', async () => {
    const issues = await detectUnknownProperties(
      { ...resource, notAThing: 1 }, profileIndex, 'Patient',
      'http://example.org/StructureDefinition/Slim',
      depsWith(() => Promise.resolve(baseWithGender)),
    );

    expect(issues.map(issue => issue.code)).toEqual(['structural-unknown-element']);
    expect(issues[0].severity).toBe('error');
  });

  // Three unlisted root keys against one listed key trips the existing sparse
  // snapshot guard, which bails before the walk; two keeps the walk running.
  it('reports the incomplete base check once, not once per property', async () => {
    const issues = await detectUnknownProperties(
      { ...resource, birthDate: '2000-01-01' },
      profileIndex, 'Patient', 'http://example.org/StructureDefinition/Slim',
      depsWith(() => Promise.reject(new Error('boom'))),
    );

    expect(issues.filter(issue => issue.code === 'profile-unreadable')).toHaveLength(1);
    expect(issues.map(issue => issue.code)).not.toContain('structural-unknown-element');
  });
});
