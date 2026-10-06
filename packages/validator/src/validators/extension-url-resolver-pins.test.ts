/**
 * An extension the validated profile names resolves at the release that
 * profile's package depends on, and each release keeps its own cache entry.
 */
import { describe, expect, it, vi } from 'vitest';
import { ExtensionUrlResolver } from './extension-url-resolver';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader';

const EXTENSION = 'http://example.org/StructureDefinition/ext';
const OLD_PROFILE = { url: 'http://example.org/StructureDefinition/old-profile', version: '1.0.0' };
const NEW_PROFILE = { url: 'http://example.org/StructureDefinition/new-profile', version: '2.0.0' };

function definition(version: string, expression: string) {
  return {
    resourceType: 'StructureDefinition',
    url: EXTENSION,
    version,
    context: [{ type: 'element', expression }],
  };
}

function loaderFor(definitions: Record<string, unknown>) {
  const loadProfile = vi.fn(async (url: string) => definitions[url] ?? null);
  const pinProfileReference = vi.fn(async (url: string, source?: { url?: string }) =>
    source?.url === OLD_PROFILE.url ? `${url}|1.0.0` : url);
  return {
    loader: { loadProfile, pinProfileReference } as unknown as StructureDefinitionLoader,
    loadProfile,
  };
}

describe('ExtensionUrlResolver dependency pins', () => {
  it('reads the declared contexts of the release the referencing profile depends on', async () => {
    const { loader } = loaderFor({
      [`${EXTENSION}|1.0.0`]: definition('1.0.0', 'Patient'),
      [EXTENSION]: definition('2.0.0', 'Observation'),
    });
    const resolver = new ExtensionUrlResolver(loader);

    const pinned = await resolver.getDeclaredContexts(EXTENSION, 'R4', OLD_PROFILE);
    const unpinned = await resolver.getDeclaredContexts(EXTENSION, 'R4', NEW_PROFILE);

    expect(pinned?.map(context => context.expression)).toEqual(['Patient']);
    expect(unpinned?.map(context => context.expression)).toEqual(['Observation']);
  });

  it('falls back to the unversioned canonical when the pinned release does not load', async () => {
    const { loader, loadProfile } = loaderFor({ [EXTENSION]: definition('2.0.0', 'Observation') });
    const resolver = new ExtensionUrlResolver(loader);

    await expect(resolver.resolveKnown(EXTENSION, 'R4', OLD_PROFILE)).resolves.toBe('resolvable');
    expect(loadProfile.mock.calls.map(([url]) => url)).toEqual([`${EXTENSION}|1.0.0`, EXTENSION]);
  });
});
