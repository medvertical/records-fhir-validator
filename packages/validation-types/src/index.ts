// Public surface — the validation-domain types that consumers (server,
// client, CLI, the validator engine itself) used to import from
// `@shared/validation`.
//
// Deep-path compatibility facades have been removed; keep new exports in
// `./validation/index` so consumers use one package entrypoint.
export * from './validation/index';
