import type { ReferenceResolver } from '../validators/slicing-validator.js';
import type { ProfileApplicationSource } from '@records-fhir/validation-types';
import type { MultiAspectDeps } from './multi-aspect-dependencies.js';
import type { MultiAspectValidateResult } from './multi-aspect-types.js';
import { MultiAspectValidationSession } from './multi-aspect-validation-session.js';
import type { CustomRuleSelectedRelease } from '../custom-rules/applicability.js';

/** Compose one isolated validation session, including its profile cache and recursive context. */
export function buildMultiAspectValidateCallback(
  deps: MultiAspectDeps,
  aspects: string[],
  settings: unknown,
  organizationId?: number,
  shouldStop?: () => boolean,
  onEmbeddedResourceValidated?: (
    resource: Record<string, unknown>,
    result: MultiAspectValidateResult,
  ) => void | Promise<void>,
  externalReferenceResolver?: ReferenceResolver,
  serverId?: number,
  profileSources?: ReadonlyMap<unknown, ProfileApplicationSource>,
  selectedRelease?: CustomRuleSelectedRelease | null,
): (
  resource: unknown,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
) => Promise<MultiAspectValidateResult> {
  return new MultiAspectValidationSession({
    deps,
    aspects,
    settings,
    organizationId,
    shouldStop,
    onEmbeddedResourceValidated,
    externalReferenceResolver,
    serverId,
    profileSources,
    selectedRelease,
  }).validate;
}
