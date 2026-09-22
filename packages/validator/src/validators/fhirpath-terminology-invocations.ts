import {
  FHIRPathTerminologyUnverifiedError,
  type FHIRPathInvocationTable,
  type FHIRPathTerminologyResolver,
  type FHIRPathTerminologyVersion,
} from './fhirpath-terminology-types.js';

const MAX_TERMINOLOGY_INPUTS = 32;
const MAX_CANONICAL_LENGTH = 2_048;

export function buildAsyncTerminologyInvocationTable(
  resolver: FHIRPathTerminologyResolver,
  fhirVersion: FHIRPathTerminologyVersion,
): FHIRPathInvocationTable {
  return {
    recordsAsyncMemberOf: {
      fn: (inputs: unknown[], valueSetUrl: unknown) =>
        resolveMemberOfInvocation(inputs, valueSetUrl, resolver, fhirVersion),
      arity: { 1: ['String'] },
    },
    recordsAsyncSubsumes: {
      fn: (inputs: unknown[], other: unknown) =>
        resolveSubsumesInvocation(inputs, other, resolver),
      arity: { 1: ['Any'] },
    },
  };
}

async function resolveMemberOfInvocation(
  inputs: unknown[],
  rawValueSetUrl: unknown,
  resolver: FHIRPathTerminologyResolver,
  fhirVersion: FHIRPathTerminologyVersion,
): Promise<boolean[]> {
  const valueSetUrl = normalizeCanonical(rawValueSetUrl);
  if (!valueSetUrl || inputs.length === 0) return [];

  const boundedInputs = inputs.slice(0, MAX_TERMINOLOGY_INPUTS);
  let sawUnverified = inputs.length > MAX_TERMINOLOGY_INPUTS;
  for (const input of boundedInputs) {
    const candidates = extractCodingCandidates(input).slice(0, MAX_TERMINOLOGY_INPUTS);
    if (candidates.length === 0) {
      sawUnverified = true;
      continue;
    }

    let itemHasValidCoding = false;
    let itemHasUnverifiedCoding = false;
    for (const candidate of candidates) {
      const outcome = await resolver.resolveCodeMembership(
        candidate.code,
        candidate.system,
        valueSetUrl,
        fhirVersion,
      );
      if (outcome === 'valid') {
        itemHasValidCoding = true;
        break;
      }
      if (outcome === 'unverified') itemHasUnverifiedCoding = true;
    }
    if (itemHasValidCoding) continue;
    if (itemHasUnverifiedCoding) {
      sawUnverified = true;
      continue;
    }
    return [false];
  }

  if (sawUnverified) {
    throw new FHIRPathTerminologyUnverifiedError(
      `ValueSet membership could not be verified for ${valueSetUrl}`,
    );
  }
  return [true];
}

async function resolveSubsumesInvocation(
  inputs: unknown[],
  other: unknown,
  resolver: FHIRPathTerminologyResolver,
): Promise<boolean[]> {
  if (inputs.length !== 1) return [];
  const left = extractCodingCandidates(inputs[0]);
  const right = extractCodingCandidates(other);
  if (left.length !== 1 || right.length !== 1) return [];

  const system = left[0].system ?? right[0].system;
  if (!system || (left[0].system && right[0].system && left[0].system !== right[0].system)) {
    return [];
  }
  const outcome = await resolver.resolveSubsumption(system, left[0].code, right[0].code);
  if (outcome === 'unknown') {
    throw new FHIRPathTerminologyUnverifiedError(
      `Code-system subsumption could not be verified for ${system}`,
    );
  }
  return [outcome === 'subsumes' || outcome === 'equivalent'];
}

function normalizeCanonical(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_CANONICAL_LENGTH ? normalized : null;
}

function extractCodingCandidates(value: unknown): Array<{ code: string; system?: string }> {
  const candidates: Array<{ code: string; system?: string }> = [];
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0 && candidates.length < MAX_TERMINOLOGY_INPUTS) {
    const current = pending.pop();
    if (typeof current === 'string' && current.length > 0) {
      candidates.push({ code: current });
      continue;
    }
    if (typeof current !== 'object' || current === null || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) pending.push(current[index]);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string' && record.code.length > 0) {
      candidates.push({
        code: record.code,
        ...(typeof record.system === 'string' && record.system.length > 0
          ? { system: record.system }
          : {}),
      });
    } else if (Array.isArray(record.coding)) {
      pending.push(record.coding);
    }
  }
  return candidates;
}
