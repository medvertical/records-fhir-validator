import { z } from 'zod';
import { lookupProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { isPinExemptCanonical } from '../package/canonical-pin-context.js';
import { profileMatchesCanonical } from './sd-loader-profile-identity.js';
import { parseProfileCanonical, type FhirVersionFamily } from './sd-loader-version-utils.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { createValidationIssue } from '../issues/issue-factory.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

const aliasSchema = z.object({
  requested: z.string(), resolved: z.string(), packageId: z.string().regex(/^[^#\s]+#[^#\s]+$/),
  fhirVersion: z.enum(['R4', 'R5', 'R6']), reason: z.string().min(1),
}).strict();
export type ProfileVersionAlias = z.infer<typeof aliasSchema>;

/** Explicit edition bindings retain the real definition identity and issued package provenance. */
export class ProfileVersionAliases {
  private readonly aliases = new Map<string, Readonly<ProfileVersionAlias>>();

  constructor(aliases: readonly ProfileVersionAlias[] = [], pins: Readonly<Record<string, string>> = {}) {
    for (const alias of z.array(aliasSchema).parse(aliases)) {
      const requested = parseProfileCanonical(alias.requested), resolved = parseProfileCanonical(alias.resolved);
      const [name, version] = alias.packageId.split('#');
      if (!requested?.version || !resolved?.version || requested.canonical !== resolved.canonical
        || !/^\d+(?:\.\d+)?$/.test(requested.version) || !resolved.version.startsWith(`${requested.version}.`)
        || isPinExemptCanonical(requested.canonical) || pins[name] !== version) {
        throw new Error('Profile version alias must name a partial edition, its exact pinned package and the same canonical');
      }
      const key = `${alias.fhirVersion}:${alias.requested}`;
      if (this.aliases.has(key)) throw new Error('Duplicate profile version alias');
      this.aliases.set(key, Object.freeze(alias));
    }
  }

  get enabled(): boolean { return this.aliases.size > 0; }

  binding(url: string, family: FhirVersionFamily, pins: Readonly<Record<string, string>>): Readonly<ProfileVersionAlias> | undefined {
    const alias = this.aliases.get(`${family}:${url}`);
    const [name, version] = alias?.packageId.split('#') ?? [];
    return alias && pins[name] === version ? alias : undefined;
  }

  resolve(url: string, family: FhirVersionFamily, pins: Readonly<Record<string, string>>): string {
    return this.binding(url, family, pins)?.resolved ?? url;
  }

  accepts(profile: StructureDefinition | null, original: string, family: FhirVersionFamily,
    pins: Readonly<Record<string, string>>): boolean {
    const alias = this.binding(original, family, pins);
    if (!profile || !alias || !profileMatchesCanonical(profile, alias.resolved, family)) return false;
    const origin = lookupProfilePackageProvenance(profile);
    return origin !== null && `${origin.name}#${origin.version}` === alias.packageId;
  }
}

export function profileVersionAliasIssue(profile: StructureDefinition, requested: string,
  family: FhirVersionFamily, resourceType: string): ValidationIssue | undefined {
  const canonical = parseProfileCanonical(requested), origin = lookupProfilePackageProvenance(profile);
  if (family !== 'R4' || !origin || !canonical?.version || canonical.canonical !== profile.url
    || !profile.version?.startsWith(`${canonical.version}.`)) return undefined;
  return createValidationIssue({ code: 'profile-version-alias', path: `${resourceType}.meta.profile`,
    resourceType, profile: requested, severityOverride: 'information', aspectOverride: 'profile',
    customMessage: 'The declared partial profile edition was evaluated against an explicitly selected package definition',
    details: { requested, resolved: `${profile.url}|${profile.version}`, packageId: `${origin.name}#${origin.version}` } });
}
