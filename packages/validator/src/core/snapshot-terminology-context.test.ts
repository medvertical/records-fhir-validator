import { describe, expect, it, vi } from 'vitest';
import { createValidationSourceContext } from './validator-terminology-snapshot-context.js';
import { withSnapshotProfileChecks } from './snapshot-profile-checks.js';
import { TerminologySourceContexts } from '../validators/terminology-source-context.js';
import type { ProfileSourceContext } from '../persistence/profile-source.js';

const scope: ProfileSourceContext = { organizationId: 1, serverId: 491, fhirVersion: 'R4', terminologySnapshotSha256: 'a'.repeat(64) };

describe('immutable terminology execution scope', () => {
  it('constructs the same snapshot identity for nested execution and rejects malformed selections', () => {
    expect(createValidationSourceContext({ organizationId: 1, serverId: 491,
      settings: { terminologyResolution: { snapshot: { sha256: scope.terminologySnapshotSha256 } } } })).toEqual(scope);
    expect(createValidationSourceContext({ organizationId: 2 })).not.toHaveProperty('terminologySnapshotSha256');
    for (const snapshot of [{}, { sha256: 'invalid' }, null]) {
      expect(() => createValidationSourceContext({ settings: { terminologyResolution: { snapshot } } })).toThrow('Invalid');
    }
  });

  it.each([
    { axis: 'dropped scope', next: undefined },
    { axis: 'dropped snapshot', next: { organizationId: 1, serverId: 491, fhirVersion: 'R4' as const } },
    { axis: 'snapshot', next: { ...scope, terminologySnapshotSha256: 'b'.repeat(64) } },
    { axis: 'tenant', next: { ...scope, organizationId: 2 } },
    { axis: 'server', next: { ...scope, serverId: 492 } },
    { axis: 'FHIR family', next: { ...scope, fhirVersion: 'R5' as const } },
  ])('rejects nested $axis changes before lookup and retains caught failures', async ({ next }) => {
    const contexts = new TerminologySourceContexts();
    const lookup = vi.fn();
    await expect(withSnapshotProfileChecks(scope, () => contexts.runWith(scope, async () => {
      try { contexts.runWith(next, lookup); } catch { /* A terminology pipeline may convert failures to issues. */ }
      return 'apparently-complete';
    }))).rejects.toMatchObject({ code: 'TERMINOLOGY_SNAPSHOT_SCOPE_CHANGED' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('retains scope for repeated same-context lookups and keeps peer requests isolated', async () => {
    const contexts = new TerminologySourceContexts();
    const other = { ...scope, organizationId: 2, terminologySnapshotSha256: 'b'.repeat(64) };
    const run = (context: ProfileSourceContext) => contexts.runWith(context, async () => {
      await Promise.resolve();
      return contexts.runWith({ ...context }, () => contexts.context());
    });
    expect(await Promise.all([run(scope), run(other)])).toEqual([scope, other]);
    expect(contexts.context()).toBeUndefined();
    expect(() => contexts.runWith(scope, () => contexts.run('R5', () => null)))
      .toThrow('Immutable terminology snapshot scope');
  });
});
