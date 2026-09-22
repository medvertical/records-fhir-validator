import { isGraphRecord } from './validation-graph-issues.js';
import { graphValuesMatch } from './validation-graph-value-matching.js';

interface PatternContainment {
  contains: boolean;
  strict: boolean;
}

export function patternStrictlyContains(narrower: unknown, broader: unknown): boolean {
  const comparison = comparePatternContainment(narrower, broader, new WeakMap());
  return comparison.contains && comparison.strict;
}

function comparePatternContainment(
  narrower: unknown,
  broader: unknown,
  visited: WeakMap<object, WeakSet<object>>,
): PatternContainment {
  if (!isGraphRecord(narrower) || !isGraphRecord(broader)) {
    return { contains: graphValuesMatch(narrower, broader), strict: false };
  }

  const comparedBroader = visited.get(narrower) ?? new WeakSet<object>();
  if (comparedBroader.has(broader)) return { contains: true, strict: false };
  comparedBroader.add(broader);
  visited.set(narrower, comparedBroader);

  let strict = Object.keys(narrower).length > Object.keys(broader).length;
  for (const [key, expected] of Object.entries(broader)) {
    if (!(key in narrower)) return { contains: false, strict: false };
    const child = comparePatternContainment(narrower[key], expected, visited);
    if (!child.contains) return { contains: false, strict: false };
    strict ||= child.strict;
  }
  return { contains: true, strict };
}
