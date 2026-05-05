# @records-fhir/validation-types

Shared TypeScript types and schemas for the Records FHIR validation domain.

This package contains validation result, issue, settings, severity, aspect, fix suggestion, and DTO definitions. It has no database, server, client, or validator runtime dependency.

This package is part of the open-source `medvertical/records-fhir-validator` surface. The Records product itself remains commercial closed source.

## Repository Boundary

This package is safe to publish with the validator because it contains only
validation-domain contracts:

- Validation issues and results.
- Validation settings and strictness types.
- Aspect and severity enums.
- Advisor rule and fix-suggestion DTOs.
- Serialization-friendly API types.

It must not depend on Records application modules, database schema, server
routes, React components, or commercial workflow code.

## Install

```sh
npm install @records-fhir/validation-types
```

## Usage

```ts
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
```

Subpath imports are exported for stable type boundaries, for example:

```ts
import type { ValidationSettings } from '@records-fhir/validation-types/validation-settings';
```

## Development

```sh
npm run typecheck --workspace @records-fhir/validation-types
npm run build --workspace @records-fhir/validation-types
npm run pack:dry --workspace @records-fhir/validation-types
```

## License

Apache-2.0.
