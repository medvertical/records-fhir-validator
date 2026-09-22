import type { TerminologyServerAttempt } from '../issues/unverified-binding-diagnostic.js';
import type { BindingStrength } from './valueset-display-utils.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { TerminologyApiClient } from './terminology-api-client.js';
import type { RemoteValueSetValidationResult } from './terminology-api-types.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type {
  CodeBindingOutcome,
  TerminologyServerOverride,
} from './valueset-types.js';
import { loadInlineValueSet } from './valueset-inline-definition.js';

type ValidateCodeViaTerminologyServerOptions = {
  apiClient: TerminologyApiClient;
  packageLoader: ValueSetPackageLoader;
  hasTerminologyServer: (override?: { url: string }) => boolean;
  code: string;
  system: string | undefined;
  valueSetUrl: string;
  bindingStrength: BindingStrength | undefined;
  override: TerminologyServerOverride | undefined;
  fhirVersion?: FhirVersion;
  codeSystemVersion?: string;
  /** Other eligible servers, asked in order when the routed server cannot answer. */
  fallbackServers?: TerminologyServerOverride[];
  /** Receives one entry per server that left the check undecided. */
  attempts?: TerminologyServerAttempt[];
};

export async function validateCodeViaTerminologyServerWithFilters({
  apiClient,
  packageLoader,
  code,
  system,
  valueSetUrl,
  bindingStrength,
  override,
  fhirVersion,
  codeSystemVersion,
  fallbackServers,
  attempts,
}: ValidateCodeViaTerminologyServerOptions): Promise<CodeBindingOutcome> {
  const valueSet = await loadInlineValueSet(packageLoader, valueSetUrl, fhirVersion, system);
  if (system && valueSet?.compose?.include?.length === 0) return 'invalid';
  const resolvedCanonical = valueSet?.version && !valueSetUrl.includes('|')
    ? `${valueSetUrl}|${valueSet.version}` : valueSetUrl;
  const validateOnServer = async (
    candidate: TerminologyServerOverride | undefined,
  ): Promise<RemoteValueSetValidationResult> => {
    const byCanonical = await apiClient.validateCodeAttempt(
      code,
      system,
      resolvedCanonical,
      bindingStrength,
      candidate,
      codeSystemVersion,
    );
    if (byCanonical.outcome !== 'unverified' || !valueSet) return byCanonical;
    return apiClient.validateCodeAttempt(code, system, resolvedCanonical, bindingStrength, candidate, codeSystemVersion, valueSet);
  };
  // The routed server answers first. A server that cannot resolve the value
  // set, or fails, hands the check to the next eligible one instead of ending
  // it as unverified: a value set unknown to one public server is often known
  // to the next.
  for (const candidate of [override, ...(fallbackServers ?? [])]) {
    const result = await validateOnServer(candidate);
    if (result.outcome !== 'unverified') return result.outcome;
    attempts?.push({
      url: result.serverUrl ?? candidate?.url ?? '',
      reason: result.reason ?? 'value-set-not-found',
    });
  }
  return 'unverified';
}
