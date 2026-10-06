import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { ProfileReferenceSource, StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import { extractExtensionContexts, type NormalizedExtensionContext } from './extension-context-matching.js';
import { extensionDefinitionCacheKey, loadExtensionProfile, rethrowUnavailableProfile } from './extension-profile-cache.js';

export class ExtensionUrlResolver {
  private readonly declaredContexts = new BoundedLruCache<string, NormalizedExtensionContext[] | 'none'>(1_024);
  constructor(private readonly sdLoader: StructureDefinitionLoader) {}

  /** A loader failure leaves extension existence undetermined. Required dependency failures propagate their receipt. */
  async resolveKnown(url: string, family: 'R4' | 'R5' | 'R6', source?: ProfileReferenceSource): Promise<'resolvable' | 'unresolvable' | 'undetermined'> {
    try { return await this.loadDefinition(url, family, source) ? 'resolvable' : 'unresolvable'; }
    catch (error: unknown) { rethrowUnavailableProfile(error); return 'undetermined'; }
  }

  async getDeclaredContexts(url: string, family: 'R4' | 'R5' | 'R6', source?: ProfileReferenceSource): Promise<NormalizedExtensionContext[] | null> {
    let definition: StructureDefinition | null;
    try { definition = await this.loadDefinition(url, family, source); }
    catch (error: unknown) { rethrowUnavailableProfile(error); return null; }
    if (!definition) return null;
    const key = extensionDefinitionCacheKey(definition, family);
    const cached = this.declaredContexts.get(key);
    if (cached) return cached === 'none' ? null : cached;
    const contexts = extractExtensionContexts(definition);
    this.declaredContexts.set(key, contexts ?? 'none');
    return contexts;
  }

  private async loadDefinition(url: string, family: 'R4' | 'R5' | 'R6', source?: ProfileReferenceSource): Promise<StructureDefinition | null> {
    const definition = await loadExtensionProfile(this.sdLoader, url, source, family);
    if (definition || family === 'R4' || !url.startsWith('http://hl7.org/fhir/StructureDefinition/')) return definition;
    // Some well-known HL7 extensions ship in R4 core but not later core packages.
    return loadExtensionProfile(this.sdLoader, url, source, 'R4');
  }
}
