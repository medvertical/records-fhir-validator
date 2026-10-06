import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { assertPackageSensitiveLoggingBoundary } from './__tests__/package-sensitive-logging-contracts';

const paths = [
  'packages/validator/src/package/package-registry-client.ts',
  'packages/validator/src/package/package-registry-http.ts',
  'packages/validator/src/package/package-downloader.ts',
  'packages/validator/src/package/package-installation-store.ts',
  'packages/validator/src/package/package-profile-detector.ts',
];

describe('package artifact sensitive logging boundary', () => {
  it.each(paths)('%s emits fixed events with bounded metadata', (path) => {
    const source = readFileSync(path, 'utf8');
    assertPackageSensitiveLoggingBoundary(path, source);
  });
});
