/**
 * Fixture Corpus Validation Tests
 *
 * Validates all JSON fixtures in server/tests/fixtures/fhir-resources/
 * through the Records validator engine:
 *
 * - **valid/** fixtures must produce zero error-level issues (precision)
 * - **invalid/** fixtures must produce at least one error/warning (recall)
 *
 * Runs against bundled R4 base profiles — no network access needed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import { readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';

// ============================================================================
// Setup
// ============================================================================

const FIXTURES_ROOT = join(process.cwd(), 'server/tests/fixtures/fhir-resources');
const VALID_DIR = join(FIXTURES_ROOT, 'valid');
const INVALID_DIR = join(FIXTURES_ROOT, 'invalid');

function loadFixtures(dir: string): Array<{ name: string; resource: any }> {
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: basename(f, '.json'),
      resource: JSON.parse(readFileSync(join(dir, f), 'utf-8')),
    }));
}

const validFixtures = loadFixtures(VALID_DIR);
const invalidFixtures = loadFixtures(INVALID_DIR);

// Known false positives — pre-existing fixtures with known validator limitations.
// When a fix resolves the issue, remove the entry and the fixture becomes a normal test.
const KNOWN_FALSE_POSITIVES = new Set<string>([
  // (empty — all previously known FPs have been resolved)
]);

// ============================================================================
// Tests
// ============================================================================

describe('Fixture Corpus', () => {
  let validator: RecordsValidator;

  beforeAll(async () => {
    validator = new RecordsValidator({
      enableCaching: true,
      strictMode: false,
      timeout: 30000,
      autoDownload: false,
    });
    validator.configureTerminologyResolution({
      strategy: 'local-only',
      serverUrl: undefined,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });
    await validator.waitForInitialization();
  }, 120_000);

  describe('Precision — valid fixtures produce no errors', () => {
    it.each(
      validFixtures
        .filter(f => !KNOWN_FALSE_POSITIVES.has(f.name))
        .map(f => [f.name, f.resource])
    )(
      '%s',
      async (name, resource) => {
        const rt = resource.resourceType;
        const profileUrl = resource.meta?.profile?.[0]
          ?? `http://hl7.org/fhir/StructureDefinition/${rt}`;
        const fhirVersion = name.startsWith('r5-') ? 'R5' as const : 'R4' as const;
        const issues = await validator.validate(resource, profileUrl, fhirVersion);

        // Exclude infrastructure errors (DB not available in test)
        const errors = issues.filter(i =>
          i.severity === 'error' &&
          i.code !== 'validation-error' // custom rule executor DB failure in test env
        );
        if (errors.length > 0) {
          const summary = errors.map(e => `  [${e.code}] ${e.path}: ${e.message}`).join('\n');
          expect.soft(errors, `${name} should have 0 errors but got:\n${summary}`).toHaveLength(0);
        }
      },
    );

    // Track known false positives — these should pass once the underlying issue is fixed
    it.each(
      validFixtures
        .filter(f => KNOWN_FALSE_POSITIVES.has(f.name))
        .map(f => [f.name, f.resource])
    )(
      '%s (known false positive)',
      async (name, resource) => {
        const rt = resource.resourceType;
        const profileUrl = resource.meta?.profile?.[0]
          ?? `http://hl7.org/fhir/StructureDefinition/${rt}`;
        const fhirVersion = name.startsWith('r5-') ? 'R5' as const : 'R4' as const;
        const issues = await validator.validate(resource, profileUrl, fhirVersion);
        const errors = issues.filter(i =>
          i.severity === 'error' && i.code !== 'validation-error'
        );
        // These are expected to fail — when they start passing, remove from KNOWN_FALSE_POSITIVES
        expect(errors.length).toBeGreaterThan(0);
      },
    );
  });

  describe('Recall — invalid fixtures produce at least one issue', () => {
    it.each(invalidFixtures.map(f => [f.name, f.resource]))(
      '%s',
      async (name, resource) => {
        const rt = resource.resourceType;
        const profileUrl = resource.meta?.profile?.[0]
          ?? `http://hl7.org/fhir/StructureDefinition/${rt}`;
        const issues = await validator.validate(resource, profileUrl, 'R4');

        // Exclude infrastructure errors; only count real validation findings
        const significant = issues.filter(i =>
          (i.severity === 'error' || i.severity === 'warning') &&
          i.code !== 'validation-error'
        );
        expect(
          significant.length,
          `${name} should produce at least 1 error/warning but got 0`,
        ).toBeGreaterThan(0);
      },
    );
  });
});
