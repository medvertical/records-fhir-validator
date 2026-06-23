import type { BindingStrength } from './valueset-display-utils';
import type { FhirVersion } from './valueset-expansion-cache-key';
import type { TerminologyApiClient } from './terminology-api-client';
import type { ValueSetPackageLoader } from './valueset-package-loader';

type TerminologyServerOverride = { url: string; auth?: any };

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
};

export async function validateCodeViaTerminologyServerWithFilters({
  apiClient,
  packageLoader,
  hasTerminologyServer,
  code,
  system,
  valueSetUrl,
  bindingStrength,
  override,
  fhirVersion,
}: ValidateCodeViaTerminologyServerOptions): Promise<boolean> {
  const isValidOnServer = await apiClient.validateCode(code, system, valueSetUrl, bindingStrength, override);
  if (isValidOnServer) return true;

  if (!system || !hasTerminologyServer(override)) return false;

  const filters = await packageLoader.getIncludeConceptFilters(valueSetUrl, fhirVersion);
  for (const filter of filters) {
    if (filter.system !== system || filter.property !== 'concept') continue;

    if (filter.op === '=' && filter.value === code) {
      return true;
    }

    if (filter.op === 'is-a' || filter.op === 'descendent-of') {
      const outcome = await apiClient.subsumes(system, filter.value, code, override);
      if (outcome === 'subsumes') return true;
      if (filter.op === 'is-a' && outcome === 'equivalent') return true;
    }
  }

  return false;
}
