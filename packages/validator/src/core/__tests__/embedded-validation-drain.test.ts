import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchValidationAbortedError } from '../batch-validator';
import { appendContainedResourceValidationResults } from '../multi-aspect-contained-validation';
import { appendParametersResourceValidationResults } from '../multi-aspect-parameters-validation';
import { appendBundleEntryValidationResults } from '../multi-aspect-bundle-entry-validation';
import { validateContainedResourceTree } from '../validator-contained-issues';
import { validateParametersResourceTree } from '../parameters-resource-validation';

const children = [{ resourceType: 'Patient', id: 'first' }, { resourceType: 'Patient', id: 'second' }];
const contained = { resourceType: 'Observation', contained: children };
const parameters = { resourceType: 'Parameters', parameter: children.map(resource => ({ name: 'child', resource })) };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function aspectValidator(validateChild: () => Promise<void>) {
  return async () => {
    await validateChild();
    return { isValid: true, aspects: [] };
  };
}

function legacyOptions(validateChild: () => Promise<void>) {
  return { recursionDepth: 0, maxDepth: 3, validate: async () => { await validateChild(); return []; } };
}

const paths: Array<{ name: string; run(validateChild: () => Promise<void>): Promise<unknown> }> = [
  { name: 'multi-aspect contained', run: validate => appendContainedResourceValidationResults(
    contained, 'R4', 0, aspectValidator(validate), [], undefined, undefined,
  ) },
  { name: 'multi-aspect Parameters', run: validate => appendParametersResourceValidationResults(
    parameters, 'R4', 0, aspectValidator(validate), [], undefined, undefined,
  ) },
  { name: 'multi-aspect Bundle chunk', run: validate => appendBundleEntryValidationResults(
    { resourceType: 'Bundle', type: 'collection', entry: [...children, { resourceType: 'Patient', id: 'later' }]
      .map(resource => ({ resource })) },
    'R4', 0, aspectValidator(validate), [], undefined,
    issues => ({ resultIssues: issues, evidenceIssues: issues }),
  ) },
  { name: 'legacy contained', run: validate => validateContainedResourceTree(contained, legacyOptions(validate)) },
  { name: 'legacy Parameters', run: validate => validateParametersResourceTree(parameters, legacyOptions(validate)) },
];

describe.each(paths)('$name cancellation drains admitted children', ({ run }) => {
  afterEach(() => vi.unstubAllEnvs());

  it('waits for the second child before rejecting the first abort and never starts another chunk', async () => {
    vi.stubEnv('VALIDATION_BUNDLE_ENTRY_CONCURRENCY', '2');
    const first = deferred();
    const second = deferred();
    const abort = new BatchValidationAbortedError();
    let started = 0;
    let settled = false;
    const observed = run(() => (++started === 1 ? first.promise : second.promise))
      .then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    expect(started).toBe(2);
    first.reject(abort);
    await new Promise<void>(resolve => setImmediate(resolve));
    const settledBeforeDrain = settled;
    second.resolve();
    expect(await observed).toBe(abort);
    expect(settledBeforeDrain).toBe(false);
    expect(started).toBe(2);
  });
});
