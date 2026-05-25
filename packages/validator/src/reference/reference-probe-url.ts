import type { ReferenceParseResult } from './reference-type-extractor';

interface ReferenceProbeUrlConfig {
  baseUrl: string;
  allowExternalAbsoluteReferences: boolean;
  allowSameOriginAbsoluteReferences: boolean;
}

export function asSummaryUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_summary=count`;
}

export function extractUrlHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function isSameOriginUrl(referenceUrl: string, baseUrl: string): boolean {
  try {
    return new URL(referenceUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function buildReferenceProbeUrl(
  reference: string,
  parseResult: ReferenceParseResult,
  config: ReferenceProbeUrlConfig
): string | null {
  if (parseResult.referenceType === 'absolute') {
    if (config.allowExternalAbsoluteReferences) {
      return reference;
    }
    if (
      config.allowSameOriginAbsoluteReferences
      && config.baseUrl
      && isSameOriginUrl(reference, config.baseUrl)
    ) {
      return reference;
    }
    return null;
  }

  if (parseResult.referenceType === 'relative' && config.baseUrl) {
    const cleanBase = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    const cleanRef = reference.startsWith('/') ? reference.slice(1) : reference;
    return `${cleanBase}/${cleanRef}`;
  }

  return null;
}
