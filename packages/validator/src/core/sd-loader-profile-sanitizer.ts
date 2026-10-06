import { logger } from '../logger.js';
import { normalizeLegacySnapshotSliceChildren } from './legacy-snapshot-slice-identity.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

const VITAL_SIGNS_PROFILE = 'http://hl7.org/fhir/StructureDefinition/vitalsigns';

/**
 * The reference validator's correction of vs-1 (StructureDefinitionHacker),
 * applied to the core vital signs profile and the profiles derived from it
 * directly. The published `($this as dateTime).toString().length() >= 8` is
 * empty for an `effectivePeriod`, so it would fail every vital sign measured
 * over a period.
 */
const VITAL_SIGNS_VS_1 = '$this is dateTime implies $this.toString().length() >= 10';

function isVitalSignsProfileFamily(sd: StructureDefinition): boolean {
  return sd.url === VITAL_SIGNS_PROFILE || sd.baseDefinition?.split('|')[0] === VITAL_SIGNS_PROFILE;
}

export function sanitizeProfile(sd: StructureDefinition): StructureDefinition {
  if (!sd || !sd.snapshot || !sd.snapshot.element) return sd;

  const elements = normalizeLegacySnapshotSliceChildren(sd.snapshot.element, sd.type);
  if (elements !== sd.snapshot.element) sd = { ...sd, snapshot: { ...sd.snapshot, element: elements } };

  const vitalSigns = isVitalSignsProfileFamily(sd);
  let patched = false;
  for (const element of [...elements, ...(sd.differential?.element ?? [])]) {
    if (!element.constraint) continue;

    for (const constraint of element.constraint) {
      if (
        constraint.expression &&
        constraint.key === 'pd-1' &&
        constraint.expression.includes('telecom or endpoint') &&
        !constraint.expression.includes('exists()')
      ) {
        constraint.expression = 'telecom.exists() or endpoint.exists()';
        patched = true;
      }
      if (vitalSigns && constraint.key === 'vs-1' && constraint.expression !== VITAL_SIGNS_VS_1) {
        constraint.expression = VITAL_SIGNS_VS_1;
        patched = true;
      }
    }
  }

  if (patched) {
    logger.debug(
      '[SDLoader] Patched constraints in profile',
      profileCanonicalMetadata(sd.url ?? ''),
    );
  }

  return sd;
}
