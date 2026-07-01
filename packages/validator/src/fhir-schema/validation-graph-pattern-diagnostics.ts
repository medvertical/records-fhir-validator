import {
  matchesPattern as matchesFhirPattern,
  valuesMatch,
} from '../validators/slice-utils';

export function matchPatternWithDiagnostic(
  value: unknown,
  pattern: unknown,
  basePath: string,
): { matches: boolean; message?: string; path?: string } {
  if (matchesFhirPattern(value, pattern)) {
    return { matches: true };
  }

  return diagnosePatternMismatch(value, pattern, basePath);
}

function diagnosePatternMismatch(value: unknown, pattern: unknown, basePath: string): { matches: boolean; message?: string; path?: string } {
  if (pattern === undefined || pattern === null) {
    return { matches: true };
  }

  if (!isRecord(pattern)) {
    if (Array.isArray(pattern)) {
      if (!Array.isArray(value)) {
        return {
          matches: false,
          message: `Element '${basePath}' is not an array but pattern requires array`,
          path: basePath,
        };
      }
      for (let i = 0; i < pattern.length; i += 1) {
        const patternItem = pattern[i];
        const hasMatch = value.some(actualItem => diagnosePatternMismatch(actualItem, patternItem, `${basePath}[${i}]`).matches);
        if (!hasMatch) {
          return {
            matches: false,
            message: `Element '${basePath}' does not contain an item matching pattern entry ${i}`,
            path: basePath,
          };
        }
      }
      return { matches: true };
    }

    return {
      matches: valuesMatch(value, pattern),
      message: `Element '${basePath}' does not match pattern`,
      path: basePath,
    };
  }

  if (Array.isArray(value)) {
    const match = value.find(item => diagnosePatternMismatch(item, pattern, basePath).matches);
    if (match !== undefined) {
      return { matches: true };
    }
    return {
      matches: false,
      message: `Element '${basePath}' does not contain an item matching pattern`,
      path: basePath,
    };
  }

  if (!isRecord(value)) {
    return {
      matches: false,
      message: `Element '${basePath}' is not an object but pattern requires object structure`,
      path: basePath,
    };
  }

  for (const [key, expected] of Object.entries(pattern)) {
    if (!(key in value)) {
      return {
        matches: false,
        message: `Element '${basePath}.${key}' is missing but required by pattern`,
        path: `${basePath}.${key}`,
      };
    }
    const child = diagnosePatternMismatch(value[key], expected, `${basePath}.${key}`);
    if (!child.matches) {
      return child;
    }
  }

  return { matches: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
