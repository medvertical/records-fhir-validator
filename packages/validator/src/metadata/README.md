# Metadata Validation Module (Refactored)

This directory contains the refactored metadata validation engine, split from the original
2,208-line `metadata-validator.ts` into focused, maintainable modules.

## Structure

```
metadata/
├── metadata-validator-refactored.ts  (200 lines) - Main orchestrator ✅
├── metadata-types.ts                 (150 lines) - Type definitions & constants ✅
├── uri-validators.ts                 (100 lines) - URI validation utilities ✅
├── completeness-checker.ts           (150 lines) - Required metadata validation ✅
├── field-validators.ts               (710 lines) - lastUpdated, versionId, source ✅
├── profile-validators.ts             (450 lines) - Profile URL validation ✅
├── security-validators.ts            (350 lines) - Security labels ✅
├── tag-validators.ts                 (370 lines) - Tag validation ✅
├── index.ts                          (50 lines)  - Public exports ✅
└── README.md                         - This file

Total: ~2,530 lines across 9 focused files (vs. 2,208 lines in one file)
```

## Completed Components

### 1. **metadata-types.ts** ✅
- `MetadataRequirement` interface
- `RESOURCE_METADATA_REQUIREMENTS` configuration
- Defines which metadata fields are required for different resource types

### 2. **uri-validators.ts** ✅
- `validateUriFormat()` - Validates URIs (URL, URN, OID, UUID)
- `looksLikeReference()` - Checks if string looks like FHIR reference
- `isValidUrl()` - Simple URL validation

### 3. **completeness-checker.ts** ✅
- `MetadataCompletenessChecker` class
- Validates presence of required metadata fields based on resource type
- Generates appropriate severity issues (error, warning, info)

### 4. **field-validators.ts** ✅
- `LastUpdatedValidator` - Validates lastUpdated format, timezone, chronology
- `VersionIdValidator` - Validates versionId format and consistency
- `SourceValidator` - Validates source URI format

### 5. **profile-validators.ts** ✅
- `ProfileValidator` - Validates profile URLs
- URL format validation
- Resource type matching
- Async profile accessibility checking
- Status validation (draft, active, retired)

### 6. **security-validators.ts** ✅
- `SecurityValidator` - Validates security labels
- Coding structure validation
- Known FHIR security systems validation
- System and code format checking

### 7. **tag-validators.ts** ✅
- `TagValidator` - Validates tags
- Coding structure validation
- System, code, display consistency
- Duplicate detection

### 8. **metadata-validator-refactored.ts** ✅
- Main orchestrator that coordinates all validators
- Checks HAPI coordinator first for existing issues
- Delegates to specialized validators
- Maintains backward compatibility

## Integration Status

✅ **All Core Components Completed:**
- Type definitions and constants
- URI validation utilities
- Completeness checking
- Field validators (lastUpdated, versionId, source)
- Profile URL validators
- Security label validators
- Tag validators
- Main orchestrator with full integration

## Usage Example

```typescript
import { MetadataValidator } from './metadata';

const validator = new MetadataValidator();
const issues = await validator.validate(
  resource,
  'Patient',
  'R4',
  coordinator
);
```

## Individual Validator Usage

```typescript
import {
  LastUpdatedValidator,
  VersionIdValidator,
  ProfileValidator,
  SecurityValidator,
  TagValidator
} from './metadata';

// Use individual validators as needed
const lastUpdatedValidator = new LastUpdatedValidator();
const issues = lastUpdatedValidator.validate(
  resource.meta.lastUpdated,
  'Patient'
);
```

## Benefits of Refactoring

1. **Maintainability**: Each file < 750 lines, focused on single responsibility
2. **Testability**: Each validator can be tested independently
3. **Reusability**: URI validators, type definitions can be used elsewhere
4. **Readability**: Clear separation of concerns
5. **Performance**: Can be parallelized if needed
6. **Type Safety**: Strong TypeScript types throughout

## Validator Responsibilities

| Validator | Responsibility | Lines |
|-----------|---------------|-------|
| LastUpdatedValidator | Timestamp format, timezone, chronology | ~300 |
| VersionIdValidator | Format, consistency, patterns | ~250 |
| SourceValidator | URI format validation | ~150 |
| ProfileValidator | URL format, accessibility, status | ~450 |
| SecurityValidator | Coding structure, known systems | ~350 |
| TagValidator | Coding structure, consistency, duplicates | ~370 |
| MetadataCompletenessChecker | Required field presence | ~150 |

## Migration Status

1. ✅ Extract types and constants
2. ✅ Extract URI validators
3. ✅ Extract completeness checker
4. ✅ Create main orchestrator
5. ✅ Extract field validators
6. ✅ Extract profile validators
7. ✅ Extract security validators
8. ✅ Extract tag validators
9. ⏳ Update imports in consuming code (Phase 2)
10. ⏳ Deprecate original file (future release)

## Backward Compatibility

The original `metadata-validator.ts` remains unchanged and will be maintained
for backward compatibility during the migration period. Once all consumers
have migrated to the new structure, the old file will be deprecated.

## Testing

Each validator module should have corresponding unit tests:
- ✅ `service-container.test.ts` (DI container)
- 🚧 `metadata-types.test.ts` (TODO)
- 🚧 `uri-validators.test.ts` (TODO)
- 🚧 `completeness-checker.test.ts` (TODO)
- 🚧 `field-validators.test.ts` (TODO)
- 🚧 `profile-validators.test.ts` (TODO)
- 🚧 `security-validators.test.ts` (TODO)
- 🚧 `tag-validators.test.ts` (TODO)

## Performance Considerations

- Validators are instantiated once in the orchestrator (singleton pattern)
- No unnecessary object creation during validation
- Early return if coordinator has issues
- Skip validation if meta field is invalid
- Optional async profile accessibility check (commented out by default for speed)

## Next Steps (Phase 2)

1. **Update Imports**: Change consuming code to use new validators
2. **Integration Testing**: Verify validators work correctly together
3. **Add Unit Tests**: Create comprehensive test suites for each validator
4. **Performance Testing**: Compare performance with original
5. **Documentation**: Update API documentation
6. **Deprecation Plan**: Plan for removing original file

## File Size Comparison

**Before Refactoring:**
- `metadata-validator.ts`: 2,208 lines (single file)

**After Refactoring:**
- 9 focused files, averaging ~280 lines each
- Largest file: `field-validators.ts` (710 lines) - still manageable
- Smallest file: `uri-validators.ts` (100 lines)
- Total: ~2,530 lines (15% increase due to documentation and structure)

The slight increase in total lines is offset by massive gains in:
- Maintainability (smaller, focused files)
- Testability (isolated components)
- Reusability (shared utilities)
- Readability (clear responsibilities)
