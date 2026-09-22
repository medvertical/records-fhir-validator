import { logger } from '../logger.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import type { TerminologyApiClient } from './terminology-api-client.js';
import { canDelegateCodeValidation } from './valueset-delegation-policy.js';
import { recordTerminologyDelegation } from './valueset-diagnostics.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import {
  hasTerminologyServer,
  listFallbackTerminologyServers,
  resolveTerminologyServerForSystem,
} from './valueset-server-routing.js';
import { validateCodeViaTerminologyServerWithFilters } from './valueset-terminology-server-validation.js';
import type {
  TerminologyDiagnostics,
  TerminologyResolutionConfig,
} from './valueset-types.js';

interface ValueSetMembershipServerDelegationDeps {
  apiClient: TerminologyApiClient;
  packageLoader: ValueSetPackageLoader;
  resolutionConfig: TerminologyResolutionConfig;
  terminologyDiagnostics: TerminologyDiagnostics;
}

interface ValueSetMembershipServerDelegationRequest {
  code: string;
  system: string | undefined;
  valueSetUrl: string;
  localExpansionIsEmpty: boolean;
  fhirVersion?: FhirVersion;
}

/**
 * Tries the optional terminology-server fallback for a direct membership check.
 * A false result means either delegation was not allowed or the server did not
 * accept the code; callers retain ownership of local fail-open policy.
 */
export async function tryValidateValueSetMembershipViaServer(
  deps: ValueSetMembershipServerDelegationDeps,
  request: ValueSetMembershipServerDelegationRequest,
): Promise<boolean> {
  const { code, system, valueSetUrl, localExpansionIsEmpty, fhirVersion } = request;
  const override = resolveTerminologyServerForSystem(
    deps.resolutionConfig,
    system,
    undefined,
    fhirVersion,
  );
  const canUseServer = hasTerminologyServer(deps.resolutionConfig, override, fhirVersion)
    && canDelegateCodeValidation(deps.resolutionConfig)
    && (
      localExpansionIsEmpty
      || deps.resolutionConfig.serverDelegation?.validateCodes === true
    );
  if (!canUseServer) return false;

  logger.debug(
    '[ValueSetValidator] Code not found in local expansion; attempting server validation',
    terminologyTargetMetadata(system, code, valueSetUrl),
  );
  recordTerminologyDelegation(
    deps.terminologyDiagnostics.delegatedBindings,
    'server-validate-code',
  );
  const outcome = await validateCodeViaTerminologyServerWithFilters({
    apiClient: deps.apiClient,
    packageLoader: deps.packageLoader,
    hasTerminologyServer: candidate => hasTerminologyServer(
      deps.resolutionConfig,
      candidate,
      fhirVersion,
    ),
    code,
    system,
    valueSetUrl,
    bindingStrength: undefined,
    override,
    fhirVersion,
    fallbackServers: listFallbackTerminologyServers(
      deps.resolutionConfig,
      override,
      system,
      undefined,
      fhirVersion,
    ),
  });
  return outcome === 'valid';
}
