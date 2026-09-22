/**
 * Filesystem-Only ProfileSource
 *
 * A `ProfileSource` implementation that resolves profiles from FHIR
 * IG packages on disk — no database, no HTTP. Drop this in via
 * `setProfileSource(createFilesystemProfileSource(...))` to give the
 * standalone engine (CLI, `@records-fhir/validator` npm package) the
 * same profile-lookup capability the server gets from its DB-backed
 * source.
 *
 * Implements `findByUrl` only. The other ProfileSource methods (bulk
 * warmup, multi-source resolveProfile) don't apply to a pure-FS
 * deployment — the SDLoader's own bundled-profile + IG-package scan
 * already covers the bundled-warmup case, and there's no remote
 * canonical resolver to chain into.
 */

import { loadFromLocalCache } from '../core/sd-loader-filesystem.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { ProfileSource } from './index.js';
import { PackageProfileIndexCache } from '../core/sd-loader-package-profile-index.js';

export interface FilesystemProfileSourceOptions {
    /**
     * One or more directories that hold IG-package subdirectories
     * (each subdir is itself a `<package-name>#<version>/` folder
     * containing `.json` StructureDefinitions, optionally nested under
     * a `package/` subdir). The bundled-profile directory is the
     * canonical example; `~/.fhir/packages` is the other.
     */
    packageDirs: string[];
    packageVersionPins?: Record<string, string>;
}

export function createFilesystemProfileSource(
    options: FilesystemProfileSourceOptions,
): ProfileSource {
    const { packageDirs } = options;
    const packageVersionPins = { ...options.packageVersionPins };
    const packageProfileIndexCache = new PackageProfileIndexCache();

    return {
        packageDirectories: [...packageDirs],

        async findByUrl(
            url: string,
            fhirVersion?: 'R4' | 'R5' | 'R6',
        ): Promise<StructureDefinition | null> {
            return loadFromLocalCache(
                url,
                packageDirs,
                fhirVersion ?? 'R4',
                packageVersionPins,
                packageProfileIndexCache,
            );
        },
    };
}
