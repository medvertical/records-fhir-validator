import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The scanner's side of this boundary is a rule in
 * config/module-boundaries.json. The walker's side is not expressible there:
 * it asserts that a module *does* reach the file system, which is a property
 * access on the `fs` namespace rather than an import or a declaration.
 */
describe('SD loader package source architecture', () => {
  it('keeps package source walking in the walker', () => {
    const walker = readFileSync(
      resolve(process.cwd(), 'packages/validator/src/core/sd-loader-package-source-walker.ts'),
      'utf8',
    );

    expect(walker).toMatch(/fs\.readdir|selectPackageVersions|packageDetails\.push/);
  });
});
