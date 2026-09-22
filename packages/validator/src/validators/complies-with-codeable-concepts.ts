/**
 * How a claimed CodeableConcept value is compared and rendered.
 *
 * The comparison is one-directional on purpose: every coding the claimed
 * profile fixes must be present in the derived one, while the derived profile
 * may add codings of its own — that is what "at least as strict" means here.
 * The formatters exist so a reason string names the values that differ.
 */

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function codeableConceptComplies(derived: unknown, base: unknown): boolean {
  const baseCodings = isObjectRecord(base) && Array.isArray(base.coding) ? base.coding : [];
  const derivedCodings =
    isObjectRecord(derived) && Array.isArray(derived.coding) ? derived.coding : [];
  for (const baseCoding of baseCodings) {
    const ok = derivedCodings.some(derivedCoding => codingMatches(derivedCoding, baseCoding));
    if (!ok) return false;
  }
  return true;
}

export function codingMatches(derived: unknown, base: unknown): boolean {
  if (!isObjectRecord(derived) || !isObjectRecord(base)) return false;
  if (typeof base.system === 'string' && derived.system !== base.system) return false;
  if (typeof base.code === 'string' && derived.code !== base.code) return false;
  if (typeof base.version === 'string' && derived.version !== base.version) return false;
  return true;
}

export function formatCodeableConcept(cc: unknown): string {
  const codings = isObjectRecord(cc) && Array.isArray(cc.coding) ? cc.coding : [];
  return `[${codings.map(formatCoding).join(', ')}]`;
}

export function formatCoding(c: unknown): string {
  if (!isObjectRecord(c)) return '#';
  const system = typeof c.system === 'string' ? c.system : '';
  const version = typeof c.version === 'string' ? `|${c.version}` : '';
  const code = typeof c.code === 'string' ? c.code : '';
  return `${system}${version}#${code}`;
}
