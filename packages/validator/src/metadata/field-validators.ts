/**
 * Field Validators for Metadata
 * 
 * Specialized validators for individual meta fields:
 * - lastUpdated (timestamp validation)
 * - versionId (format and consistency)
 * - source (URI validation)
 * 
 * These validators check format, consistency, and best practices
 * for metadata fields.
 * 
 * This file now acts as a barrel file, re-exporting validators from
 * the validators/ subdirectory to comply with global.mdc guidelines.
 */

export { LastUpdatedValidator } from './validators/last-updated-validator';
export { VersionIdValidator } from './validators/version-id-validator';
export { SourceValidator } from './validators/source-validator';
