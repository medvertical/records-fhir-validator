import { logger } from '../logger.js';
import type { TerminologyApiClient } from './terminology-api-client.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import { classifyUnverifiableFilterReason } from './valueset-filter-checks.js';
import { isLanguageBinding, validateBCP47 } from './valueset-language-utils.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { TwoPhaseShadowEvaluator } from './valueset-two-phase-shadow.js';
import { recordTerminologyReason } from './valueset-diagnostics.js';
import type {
  TerminologyDiagnostics,
  TerminologyResolutionConfig,
} from './valueset-types.js';
import { codeSystemCanonicalCandidates } from './code-system-canonical-aliases.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { tryValidateValueSetMembershipViaServer } from './valueset-membership-server-delegation.js';

interface ValueSetMembershipValidationDeps {
  apiClient: TerminologyApiClient;
  getExpandedValueSet: (
    valueSetUrl: string,
    fhirVersion?: FhirVersion,
  ) => Promise<Set<string>>;
  packageLoader: ValueSetPackageLoader;
  resolutionConfig: TerminologyResolutionConfig;
  terminologyDiagnostics: TerminologyDiagnostics;
  twoPhaseShadow: TwoPhaseShadowEvaluator;
}

export async function validateValueSetMembership(
  deps: ValueSetMembershipValidationDeps,
  code: string,
  system: string | undefined,
  valueSetUrl: string,
  fhirVersion?: FhirVersion,
): Promise<boolean> {
  const {
    apiClient,
    getExpandedValueSet,
    packageLoader,
    resolutionConfig,
    terminologyDiagnostics,
    twoPhaseShadow,
  } = deps;

  try {
    if (isLanguageBinding(valueSetUrl, system)) {
      return validateBCP47(code);
    }

    const context = { code, system, valueSetUrl };
    const twoPhaseLookup = await twoPhaseShadow.lookup(
      code,
      system,
      valueSetUrl,
      fhirVersion,
    );
    const enforcedTwoPhaseResult = twoPhaseShadow.getEnforcedResult(twoPhaseLookup);
    if (enforcedTwoPhaseResult !== undefined) {
      return twoPhaseShadow.finish(twoPhaseLookup, enforcedTwoPhaseResult, context);
    }

    const expandedCodes = await getExpandedValueSet(valueSetUrl, fhirVersion);
    const fullCodes = system
      ? codeSystemCanonicalCandidates(system).map(candidate => `${candidate}|${code}`)
      : [code];
    if (fullCodes.some(fullCode => expandedCodes.has(fullCode)) || expandedCodes.has(code)) {
      return twoPhaseShadow.finish(twoPhaseLookup, true, context);
    }

    const isValidOnServer = await tryValidateValueSetMembershipViaServer({
      apiClient,
      packageLoader,
      resolutionConfig,
      terminologyDiagnostics,
    }, {
      code,
      system,
      valueSetUrl,
      localExpansionIsEmpty: expandedCodes.size === 0,
      fhirVersion,
    });
    if (isValidOnServer) {
      return twoPhaseShadow.finish(twoPhaseLookup, true, context);
    }

    const filteredIncludes = await packageLoader.getIncludeConceptFilters(
      valueSetUrl,
      fhirVersion,
    );
    const unverifiableReason = classifyUnverifiableFilterReason(
      system,
      code,
      filteredIncludes,
    );
    if (unverifiableReason) {
      logger.debug('[ValueSetValidator] ValueSet membership cannot be verified locally', {
        ...terminologyTargetMetadata(system, code, valueSetUrl),
        reason: unverifiableReason,
      });
      recordTerminologyReason(
        terminologyDiagnostics.failOpenMembershipChecks,
        unverifiableReason,
      );
      return twoPhaseShadow.finish(twoPhaseLookup, true, context);
    }

    return twoPhaseShadow.finish(twoPhaseLookup, false, context);
  } catch (error: unknown) {
    logger.warn(
      '[ValueSetValidator] Could not validate code against ValueSet',
      validationFailureMetadata(error),
    );
    recordTerminologyReason(
      terminologyDiagnostics.failOpenMembershipChecks,
      'validation-error',
    );
    return true;
  }
}
