// Public surface — the validation-domain types that consumers (server,
// client, CLI, the validator engine itself) used to import from
// `@shared/validation`.
//
// `validation-settings.ts`, `validation-types.ts` and `fix-suggestions.ts`
// are deep-path-only (accessible via `@records-fhir/validation-types/...`)
// — they are back-compat facades that re-export pieces of `./validation/`
// under different names; including them here would create duplicate-export
// ambiguity for symbols defined in both places.
export * from './validation/index';
