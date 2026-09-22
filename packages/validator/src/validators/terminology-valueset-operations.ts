import { makeValueSetNotResolvableCacheKey } from './terminology-api-cache.js';
import { getTerminologyServerScope } from './terminology-server-scope.js';
import { expandValueSetViaTerminologyServer } from './terminology-valueset-expand-request.js';
import type { TerminologyValueSetOperationsContext } from './terminology-valueset-operation-context.js';
import { canDelegateValueSetExpansion } from './valueset-delegation-policy.js';
import type { TerminologyServerOverride } from './valueset-types.js';

export type { TerminologyValueSetOperationsContext } from './terminology-valueset-operation-context.js';
export { validateCodeAgainstRemoteValueSet } from './terminology-valueset-validation-operation.js';

export async function executeRemoteValueSetExpansion(
  context: TerminologyValueSetOperationsContext,
  valueSetUrl: string,
  override?: TerminologyServerOverride,
): Promise<Set<string> | null> {
  const config = context.getConfig();
  if (!canDelegateValueSetExpansion(config)) return null;
  return expandValueSetViaTerminologyServer({
    broker: context.requestBroker,
    circuitBreakers: context.circuitBreakers,
    cache: context.cache,
    config,
    override,
    requestConfigBuilder: context.requestConfigBuilder,
    valueSetUrl,
  });
}

export function isRemoteValueSetNotResolvable(
  context: TerminologyValueSetOperationsContext,
  valueSetUrl: string,
  override?: TerminologyServerOverride,
  system?: string,
  codeSystemVersion?: string,
): boolean {
  const config = context.getConfig();
  const serverUrl = override?.url ?? config.serverUrl;
  if (!serverUrl) return false;
  const serverScope = getTerminologyServerScope(
    serverUrl,
    override?.auth ?? config.auth,
  );
  return context.operationCache.getValueSetNotResolvable(
    makeValueSetNotResolvableCacheKey(
      serverScope,
      valueSetUrl,
      system,
      codeSystemVersion,
    ),
  ) === true;
}
