/**
 * A discriminator path may traverse a reference: `item.resolve().code` reads
 * the Reference at `item`, resolves it, and evaluates `code` on the target.
 * `resolve()` and `$this.resolve()` read the sliced element itself.
 */
export interface ResolveDiscriminatorStep {
  /** Where the Reference lives relative to the sliced element; `$this` for the element itself. */
  referencePath: string;
  /** Path evaluated on the resolved target; empty for the target as a whole. */
  remainder: string;
}

const RESOLVE_CALL = 'resolve()';

export function splitResolveDiscriminatorPath(path: string): ResolveDiscriminatorStep | null {
  const normalized = path.startsWith('$this.') ? path.slice('$this.'.length) : path;
  const marker = normalized.indexOf(RESOLVE_CALL);
  if (marker === -1) return null;
  const head = normalized.slice(0, marker);
  if (head !== '' && !head.endsWith('.')) return null;
  return {
    referencePath: head === '' ? '$this' : head.slice(0, -1),
    remainder: normalized.slice(marker + RESOLVE_CALL.length).replace(/^\./, ''),
  };
}
