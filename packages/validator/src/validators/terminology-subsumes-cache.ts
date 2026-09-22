export function makeSubsumesCacheKey(
  serverUrl: string,
  system: string,
  codeA: string,
  codeB: string,
): string {
  return JSON.stringify([serverUrl, system, codeA, codeB]);
}

export function makeSubsumesCacheSuffix(system: string, codeA: string, codeB: string): string {
  return JSON.stringify([system, codeA, codeB]).slice(1);
}
