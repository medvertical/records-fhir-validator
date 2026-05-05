# FHIR Package Auto-Download

Automatic download of FHIR packages from `packages.fhir.org` when profiles are not found locally.

This module is part of the open-source `@records-fhir/validator` package. It
must remain independent from Records server routes, database repositories, and
commercial application settings. Host applications configure it through package
options and environment variables.

## Features

- ✅ **Automatic Detection:** Detects required package from profile URL
- ✅ **On-Demand Download:** Downloads only when needed
- ✅ **Configurable:** Enable/disable via environment variables
- ✅ **Allowlist:** Control which packages can be downloaded
- ✅ **Cache Sharing:** Uses shared `~/.fhir/packages` cache (compatible with HAPI)
- ✅ **Error Handling:** Graceful fallback if download fails
- ✅ **Concurrent Prevention:** Lock mechanism prevents duplicate downloads

## Configuration

### Environment Variables

```bash
# Enable auto-download (default: false)
FHIR_AUTO_DOWNLOAD_PACKAGES=true

# Allowed packages (default: common packages)
# - * (all packages)
# - comma-separated list
# - prefix wildcards (e.g., de.gematik.*)
FHIR_ALLOWED_PACKAGES=*

# Cache path (default: ~/.fhir/packages)
FHIR_PACKAGE_CACHE_PATH=~/.fhir/packages

# Download timeout in ms (default: 30000)
FHIR_DOWNLOAD_TIMEOUT=30000
```

### Default Allowed Packages

If `FHIR_ALLOWED_PACKAGES` is not set, the following packages are allowed:
- `hl7.fhir.us.core`
- `hl7.fhir.r4.core`
- `hl7.fhir.r5.core`
- `de.basisprofil.r4`
- `de.gematik.isik-basismodul`
- `kbv.basis`
- `uk.core`
- `hl7.fhir.au.base`
- `hl7.fhir.ca.baseline`

## Usage

### Automatic (Recommended)

Set environment variable and let it work automatically:

```bash
export FHIR_AUTO_DOWNLOAD_PACKAGES=true
export FHIR_ALLOWED_PACKAGES=*
```

When you validate a resource with a profile that's not found locally, the system will:
1. Detect the required package from the profile URL
2. Download it from `packages.fhir.org`
3. Extract it to `~/.fhir/packages/<packageId>#<version>`
4. Retry the validation

### Programmatic

```typescript
import { RecordsValidator } from './validator-engine';

const validator = new RecordsValidator({
  // Auto-download is controlled by env var
  enableCaching: true,
});

// Will auto-download hl7.fhir.us.core if not found
const issues = await validator.validate(
  resource,
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
  'R4'
);
```

## Architecture

### Components

**1. PackageRegistryClient** (`package-registry-client.ts`)
- Communicates with `packages.fhir.org` API
- Fetches package manifests and downloads tarballs
- Caches manifests (1 hour TTL)
- Detects package ID from profile URL

**2. PackageDownloader** (`package-downloader.ts`)
- Downloads and extracts packages
- Atomic writes (temp → rename)
- Package verification
- Concurrent download prevention
- Size limits (500 MB default)

**3. Integration** (`structure-definition-loader.ts`)
- Auto-download on profile miss
- Automatic cache rescan after download
- Graceful fallback on error

### Package Detection

Automatic mapping from profile URL to package ID:

| Profile URL | Detected Package |
|-------------|------------------|
| `http://hl7.org/fhir/us/core/...` | `hl7.fhir.us.core` |
| `http://fhir.de/...` | `de.basisprofil.r4` |
| `https://gematik.de/.../isik/...` | `de.gematik.isik-basismodul` |
| `https://www.medizininformatik.../...` | `de.medizininformatikinitiative.kerndatensatz` |
| `https://fhir.kbv.de/...` | `kbv.basis` |
| `http://hl7.org.uk/...` | `uk.core` |
| `http://hl7.org.au/...` | `hl7.fhir.au.base` |
| `http://hl7.org/fhir/ca/...` | `hl7.fhir.ca.baseline` |

## Security

### Allowlist System

Prevent arbitrary package downloads:

```bash
# Allow all packages
FHIR_ALLOWED_PACKAGES=*

# Allow specific packages
FHIR_ALLOWED_PACKAGES=hl7.fhir.us.core,de.basisprofil.r4

# Allow by prefix (wildcard)
FHIR_ALLOWED_PACKAGES=de.gematik.*,hl7.fhir.us.*

# Disable auto-download (empty list)
FHIR_AUTO_DOWNLOAD_PACKAGES=false
```

### Package Verification

Before accepting a downloaded package:
1. ✅ Validates `package/package.json` exists
2. ✅ Checks `name` and `version` fields
3. ✅ Ensures complete extraction

### Size Limits

- Default: 500 MB maximum
- Prevents disk exhaustion
- Configurable per instance

## API

### PackageRegistryClient

```typescript
const client = new PackageRegistryClient();

// Fetch package manifest
const manifest = await client.fetchPackageManifest('hl7.fhir.us.core');

// Get package info
const info = await client.getPackageInfo('hl7.fhir.us.core', '6.1.0');

// Download tarball
const tarball = await client.downloadPackageTarball('hl7.fhir.us.core', '6.1.0');

// Detect package from profile URL
const packageId = client.detectPackageForProfile(
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
);
// → 'hl7.fhir.us.core'
```

### PackageDownloader

```typescript
const downloader = new PackageDownloader();

// Download and install
const result = await downloader.downloadAndInstall('hl7.fhir.us.core', '6.1.0');

if (result.success) {
  console.log(`Installed: ${result.path}`);
} else {
  console.error(`Failed: ${result.error}`);
}

// List installed packages
const installed = await downloader.listInstalledPackages();

// Remove package
await downloader.removePackage('hl7.fhir.us.core', '6.1.0');
```

## Error Handling

### Network Errors

```typescript
// Timeout after 30s
// Graceful fallback: continues without profile
```

### Package Not Found

```typescript
// If package registry returns 404
// → Profile validation fails gracefully
```

### Download Failures

```typescript
// If download fails (network error, timeout, etc.)
// → Logs error, continues without profile
```

### Concurrent Downloads

```typescript
// Lock mechanism prevents duplicate downloads
// Second request waits or skips
```

## Performance

### Download Times

- **US Core (8 MB):** ~5-10 seconds
- **German Basisprofile (12 MB):** ~8-15 seconds
- **Depends on:** Network speed, server load

### Caching

- **Manifest Cache:** 1 hour TTL
- **Package Cache:** Permanent (until manually removed)
- **In-Memory Cache:** StructureDefinitions loaded once

## Troubleshooting

### Package not downloading?

1. Check `FHIR_AUTO_DOWNLOAD_PACKAGES=true`
2. Check package is in allowed list
3. Check network connectivity
4. Check logs for errors

### Wrong package downloaded?

1. Check profile URL detection logic in `detectPackageForProfile()`
2. Manual override if needed

### Disk space issues?

1. Check `~/.fhir/packages` size
2. Remove old packages manually
3. Adjust size limits if needed

## Examples

### Example 1: US Core Patient

```typescript
const resource = {
  resourceType: 'Patient',
  meta: {
    profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient']
  },
  // ... other fields
};

// Auto-downloads hl7.fhir.us.core if not found
const issues = await validator.validate(
  resource,
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
  'R4'
);
```

### Example 2: German Basisprofile

```typescript
const resource = {
  resourceType: 'Patient',
  meta: {
    profile: ['http://fhir.de/StructureDefinition/Patient']
  },
  // ... other fields
};

// Auto-downloads de.basisprofil.r4 if not found
const issues = await validator.validate(
  resource,
  'http://fhir.de/StructureDefinition/Patient',
  'R4'
);
```

## See Also

- [Records Validator README](../README.md)
- [Phase 2 Implementation Plan](../../../../../PHASE2_AUTO_DOWNLOAD_PLAN.md)
- [Phase 2 Completion Summary](../../../../../PHASE2_AUTO_DOWNLOAD_COMPLETE.md)
