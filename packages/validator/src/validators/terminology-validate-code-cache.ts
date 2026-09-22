import type { BindingStrength } from './valueset-display-utils.js';

export function makeValidateCodeCacheKey(
  serverUrl: string,
  system: string | undefined,
  code: string,
  valueSetUrl: string,
  bindingStrength: BindingStrength | undefined,
  codeSystemVersion?: string,
): string {
  return JSON.stringify([
    serverUrl,
    system ?? null,
    code,
    valueSetUrl,
    codeSystemVersion ?? null,
    bindingStrength === 'required' ? 'required' : 'non-required',
  ]);
}

export function makeValueSetNotResolvableCacheKey(
  serverUrl: string,
  valueSetUrl: string,
  system?: string,
  codeSystemVersion?: string,
): string {
  return JSON.stringify([
    serverUrl,
    valueSetUrl,
    system ?? null,
    codeSystemVersion ?? null,
  ]);
}
