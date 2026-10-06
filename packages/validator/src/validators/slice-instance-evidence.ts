import { AsyncLocalStorage } from 'node:async_hooks';

interface SliceInstanceEvidence {
  ancestry: WeakMap<object, ReadonlySet<string>>;
  conformingSlices: WeakMap<object, ReadonlySet<string>>;
  typedSlice: WeakMap<object, string>;
  partialProfileMembership: WeakMap<object, ReadonlyMap<string, boolean | undefined>>;
}
const scopes = new AsyncLocalStorage<SliceInstanceEvidence>();
const standalone = createEvidence();
function createEvidence(): SliceInstanceEvidence {
  return { ancestry: new WeakMap(), conformingSlices: new WeakMap(), typedSlice: new WeakMap(), partialProfileMembership: new WeakMap() };
}
/** A shared instance object may be validated concurrently under different selected definitions. */
export function withSliceInstanceEvidence<T>(run: () => T): T {
  return scopes.run(createEvidence(), run);
}
export function sliceInstanceEvidence(): SliceInstanceEvidence {
  return scopes.getStore() ?? standalone;
}
