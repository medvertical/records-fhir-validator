import type { CodeInfo } from './valueset-display-utils';

type CodingLike = {
  code?: unknown;
  system?: unknown;
  display?: unknown;
};

type CodeValueLike = {
  code?: unknown;
  system?: unknown;
  display?: unknown;
  coding?: unknown;
};

export function extractCodeInfo(code: unknown): CodeInfo | null {
  return extractCodeInfos(code)[0] ?? null;
}

export function extractCodeInfos(code: unknown): CodeInfo[] {
  if (!code) return [];

  if (typeof code === 'string') {
    if (code.length === 0) return [];
    return [{ code }];
  }

  const codeValue = code as CodeValueLike;
  if (typeof codeValue.code === 'string') {
    if (codeValue.code.length === 0) return [];
    return [{
      code: codeValue.code,
      system: typeof codeValue.system === 'string' ? codeValue.system : undefined,
      display: typeof codeValue.display === 'string' ? codeValue.display : undefined,
    }];
  }

  if (Array.isArray(codeValue.coding) && codeValue.coding.length > 0) {
    return codeValue.coding
      .map((coding: CodingLike, index: number): CodeInfo | null => {
        if (typeof coding.code !== 'string' || coding.code.length === 0) return null;
        return {
          code: coding.code,
          system: typeof coding.system === 'string' ? coding.system : undefined,
          display: typeof coding.display === 'string' ? coding.display : undefined,
          codingIndex: index,
        };
      })
      .filter((coding): coding is CodeInfo => coding !== null);
  }

  return [];
}
