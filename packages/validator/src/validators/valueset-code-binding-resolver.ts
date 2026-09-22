import type {
  TerminologyServerAttempt,
  UnverifiedBindingDiagnostic,
} from '../issues/unverified-binding-diagnostic.js';
import { logger } from '../logger.js';
import { codeSystemCanonicalCandidates } from './code-system-canonical-aliases.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import {
  classifyUnverifiableComposeReason,
  isLocallyUnprovableMissReason,
} from './valueset-filter-checks.js';
import { isLanguageBinding, validateBCP47 } from './valueset-language-utils.js';
import { isMimeTypesValueSet, validateMimeTypeBindingCode } from './valueset-mimetype-utils.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { TwoPhaseShadowEvaluator } from './valueset-two-phase-shadow.js';
import type { BindingStrength } from './valueset-display-utils.js';
import type {
  CodeBindingOutcome,
  TerminologyDiagnostics,
  TerminologyResolutionConfig,
  TerminologyServerOverride,
  TerminologyUnverifiedReason,
} from './valueset-types.js';
import { recordTerminologyDelegation, recordTerminologyReason } from './valueset-diagnostics.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { canDelegateCodeValidation } from './valueset-delegation-policy.js';
import { isSnomedEditionRouteMissing } from './valueset-server-routing.js';

interface CodeBindingResolutionDeps {
  getExpandedValueSet: (valueSetUrl: string, fhirVersion?: FhirVersion) => Promise<Set<string>>;
  hasTerminologyServer: (override?: { url: string }, fhirVersion?: FhirVersion) => boolean;
  packageLoader: ValueSetPackageLoader;
  resolutionConfig: TerminologyResolutionConfig;
  resolveServerForSystem: (
    system?: string,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
  ) => TerminologyServerOverride | undefined;
  terminologyDiagnostics: TerminologyDiagnostics;
  twoPhaseShadow: TwoPhaseShadowEvaluator;
  /** Receives the explanation whenever the outcome is `unverified`. */
  recordUnverifiedBinding?: (diagnostic: UnverifiedBindingDiagnostic) => void;
  validateViaServer: (
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    bindingStrength: BindingStrength,
    override: TerminologyServerOverride | undefined,
    fhirVersion?: FhirVersion,
    codeSystemVersion?: string,
    attempts?: TerminologyServerAttempt[],
  ) => Promise<CodeBindingOutcome>;
}

interface UnverifiedContext {
  localExpansion: UnverifiedBindingDiagnostic['localExpansion'];
  attempts: TerminologyServerAttempt[];
  hasServer: boolean;
  canDelegate: boolean;
}

function noteUnverified(
  deps: CodeBindingResolutionDeps,
  cause: TerminologyUnverifiedReason,
  context: UnverifiedContext,
): 'unverified' {
  recordTerminologyReason(deps.terminologyDiagnostics.unverifiedBindings, cause);
  const serverSkipped = context.attempts.length > 0
    ? undefined
    : !context.canDelegate ? 'delegation-disabled' : !context.hasServer ? 'no-server' : 'not-needed';
  deps.recordUnverifiedBinding?.({
    cause,
    localExpansion: context.localExpansion,
    serverAttempts: context.attempts,
    ...(serverSkipped ? { serverSkipped } : {}),
    packageScope: deps.packageLoader.hasHostPackageScope?.() ? 'tenant' : 'none',
  });
  return 'unverified';
}

export async function resolveValueSetCodeBinding(
  deps: CodeBindingResolutionDeps,
  code: string,
  system: string | undefined,
  valueSetUrl: string,
  bindingStrength: BindingStrength,
  fhirVersion?: FhirVersion,
  elementPath?: string,
  codeSystemVersion?: string,
): Promise<CodeBindingOutcome> {
  if (isLanguageBinding(valueSetUrl, system)) return validateBCP47(code) ? 'valid' : 'invalid';
  if (isMimeTypesValueSet(valueSetUrl)) {
    return validateMimeTypeBindingCode(code, system, elementPath) ? 'valid' : 'invalid';
  }
  if (codeSystemVersion?.trim()) {
    return resolveVersionedCodeBinding(
      deps,
      code,
      system,
      valueSetUrl,
      bindingStrength,
      fhirVersion,
      codeSystemVersion,
    );
  }

  const lookup = await deps.twoPhaseShadow.lookup(code, system, valueSetUrl, fhirVersion);
  const enforced = deps.twoPhaseShadow.getEnforcedResult(lookup);
  if (enforced !== undefined) {
    return deps.twoPhaseShadow.finish(lookup, enforced, { code, system, valueSetUrl })
      ? 'valid'
      : 'invalid';
  }

  const expandedCodes = await deps.getExpandedValueSet(valueSetUrl, fhirVersion);
  const fullCodes = system
    ? codeSystemCanonicalCandidates(system).map(candidate => `${candidate}|${code}`)
    : [code];
  const isInExpansion = fullCodes.some(fullCode => expandedCodes.has(fullCode))
    || (bindingStrength !== 'required' && expandedCodes.has(code));
  if (isInExpansion) {
    return deps.twoPhaseShadow.finish(lookup, true, { code, system, valueSetUrl })
      ? 'valid'
      : 'invalid';
  }
  logRequiredBindingMiss(bindingStrength, system, code, valueSetUrl);

  const filteredIncludes = await deps.packageLoader.getIncludeConceptFilters(valueSetUrl, fhirVersion);
  const unenumerableIncludes = await deps.packageLoader.getUnenumerableSystemIncludes(valueSetUrl, fhirVersion);
  const unverifiableReason = classifyUnverifiableComposeReason(
    system, code, filteredIncludes, unenumerableIncludes,
  );
  const override = deps.resolveServerForSystem(system, fhirVersion, codeSystemVersion);
  const editionRouteMissing = isSnomedEditionRouteMissing(
    system,
    codeSystemVersion,
    override,
  );
  const hasServer = !editionRouteMissing && deps.hasTerminologyServer(override, fhirVersion);
  const canDelegate = canDelegateCodeValidation(deps.resolutionConfig);
  const shouldDelegate = canDelegate && (
    expandedCodes.size === 0
    || filteredIncludes.length > 0
    || unverifiableReason === 'unenumerable-system-include'
    || bindingStrength !== 'required'
  );
  const attempts: TerminologyServerAttempt[] = [];
  if (hasServer && shouldDelegate) {
    recordTerminologyDelegation(deps.terminologyDiagnostics.delegatedBindings, 'server-validate-code');
    const serverOutcome = await deps.validateViaServer(
      code,
      system,
      valueSetUrl,
      bindingStrength,
      override,
      fhirVersion,
      codeSystemVersion,
      attempts,
    );
    if (serverOutcome === 'valid') {
      return deps.twoPhaseShadow.finish(lookup, true, { code, system, valueSetUrl })
        ? 'valid'
        : 'invalid';
    }
    if (serverOutcome === 'invalid') {
      return deps.twoPhaseShadow.finish(lookup, false, { code, system, valueSetUrl })
        ? 'valid'
        : 'invalid';
    }
  }

  // A compose filter the local expander cannot evaluate (e.g. LOINC
  // SCALE_TYP=...) or a whole-system include whose CodeSystem is not locally
  // enumerable makes the local expansion provably incomplete for the coded
  // system, so without a definitive server result even a required-binding miss
  // cannot be asserted. Fully enumerated composes keep their authoritative
  // required-binding error.
  const requiredMissUnprovable = bindingStrength === 'required'
    && isLocallyUnprovableMissReason(unverifiableReason);
  const unverifiedContext: UnverifiedContext = {
    localExpansion: expandedCodes.size === 0 ? 'none' : 'incomplete',
    attempts,
    hasServer,
    canDelegate,
  };
  if (unverifiableReason && (bindingStrength !== 'required' || requiredMissUnprovable)) {
    deps.twoPhaseShadow.finish(lookup, true, { code, system, valueSetUrl });
    return noteUnverified(deps, unverifiableReason, unverifiedContext);
  }
  if (expandedCodes.size === 0) {
    deps.twoPhaseShadow.finish(lookup, true, { code, system, valueSetUrl });
    return noteUnverified(deps, 'empty-expansion', unverifiedContext);
  }
  return deps.twoPhaseShadow.finish(lookup, false, { code, system, valueSetUrl })
    ? 'valid'
    : 'invalid';
}

async function resolveVersionedCodeBinding(
  deps: CodeBindingResolutionDeps,
  code: string,
  system: string | undefined,
  valueSetUrl: string,
  bindingStrength: BindingStrength,
  fhirVersion: FhirVersion | undefined,
  codeSystemVersion: string,
): Promise<CodeBindingOutcome> {
  const override = deps.resolveServerForSystem(system, fhirVersion, codeSystemVersion);
  const canDelegate = canDelegateCodeValidation(deps.resolutionConfig);
  const hasServer = !isSnomedEditionRouteMissing(system, codeSystemVersion, override)
    && deps.hasTerminologyServer(override, fhirVersion);
  const attempts: TerminologyServerAttempt[] = [];
  if (hasServer && canDelegate) {
    recordTerminologyDelegation(deps.terminologyDiagnostics.delegatedBindings, 'server-validate-code');
    const serverOutcome = await deps.validateViaServer(
      code,
      system,
      valueSetUrl,
      bindingStrength,
      override,
      fhirVersion,
      codeSystemVersion,
      attempts,
    );
    if (serverOutcome === 'valid') return 'valid';
    if (serverOutcome === 'invalid') return 'invalid';
  }
  return noteUnverified(deps, 'versioned-binding-unverified', {
    localExpansion: 'none',
    attempts,
    hasServer,
    canDelegate,
  });
}

function logRequiredBindingMiss(
  bindingStrength: BindingStrength,
  system: string | undefined,
  code: string,
  valueSetUrl: string,
): void {
  if (bindingStrength !== 'required' || !system) return;
  logger.debug(
    '[ValueSetValidator] Required binding code not in expansion',
    terminologyTargetMetadata(system, code, valueSetUrl),
  );
}
