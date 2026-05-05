/**
 * Engine Types — `@shared` Boundary
 *
 * Single re-export point for the five `@shared/` types the records-
 * validator engine depends on. Engine modules import from here
 * (`<rel>/types`) instead of reaching directly into `@shared/...`,
 * which keeps the engine's coupling surface to the rest of the
 * monorepo at exactly one file.
 *
 * Why this exists
 * ---------------
 * The engine is on track to be extracted into the standalone
 * `@records-fhir/validator` npm package (S-2 in the validation-engine
 * roadmap). The barrier today is that engine source files import a
 * small set of types from the broader `@shared/` directory — types
 * that are co-located with server-only concerns (Drizzle schema, DTOs,
 * settings transformers) we don't want to ship in the engine package.
 *
 * Concentrating those imports in a single re-export gives us:
 * - one file to flip when extracting (replace re-exports with
 *   in-package definitions, or point at a peer-dep
 *   `@records-fhir/types` package);
 * - no behaviour change today (TypeScript erases re-exports at
 *   compile time);
 * - zero impact on server / client consumers of `@shared/...` — they
 *   keep importing from `@shared/...` as before.
 *
 * Adding new engine-needed types
 * ------------------------------
 * Re-export them here, not directly from `@shared/...` in engine
 * modules. Keep the surface small — every type added here becomes
 * something the standalone engine package will need to ship.
 */

export type { ValidationIssue, ValidationSettings, ProfileSourcesConfig } from '@records-fhir/validation-types';
export type { TerminologyServer } from '@records-fhir/validation-types/validation-settings';
export type { ValidationAspectType } from '@records-fhir/validation-types/validation/aspect-enums';

// Validator-side interfaces: ValidationContext + per-aspect IValidator
// contracts. Vendored from server/services/validation/interfaces/ during
// S-3 engine extraction; consumed by the engine's per-aspect executors.
export type {
    ValidationContext,
    IValidator,
    IStructuralValidator,
    IProfileValidator,
    ITerminologyValidator,
    IReferenceValidator,
    IInvariantValidator,
    ICustomRuleValidator,
    IMetadataValidator,
} from './validators';
