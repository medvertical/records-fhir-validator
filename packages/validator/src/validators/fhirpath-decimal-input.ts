import fhirpath from 'fhirpath';
import { numberSource } from '../input/number-source.js';
import { copyFhirPrimitiveContext } from '../core/fhir-primitive-sidecar.js';
import { createSchemaCursor, resolveChild, type SchemaCursor } from '../input/fhir-xml-schema-cursor.js';
import type { ProfileConformanceLookup } from './sd-fhirpath-profile-conformance.js';

export class DecimalSourceUnavailableError extends Error {
  constructor() {
    super('Original decimal representation is unavailable for this FHIRPath conversion');
    this.name = 'DecimalSourceUnavailableError';
  }
}

function unavailableDecimal(value: number) {
  const decimal = fhirpath.FP_Decimal.getDecimal(value);
  unavailableSources.add(decimal);
  return decimal;
}

const unavailableSources = new WeakSet<object>();

export function assertDecimalSourceAvailable(values: readonly unknown[]): void {
  const unknownSource = (value: unknown, depth = 0): boolean => {
    if (!value || typeof value !== 'object' || depth > 3) return false;
    if (unavailableSources.has(value)) return true;
    return unknownSource(Reflect.get(value, 'data'), depth + 1) || unknownSource(Reflect.get(value, 'value'), depth + 1);
  };
  if (values.some(value => unknownSource(value))) throw new DecimalSourceUnavailableError();
}

/** A validation-local evaluation graph; the caller's FHIR numbers stay numbers. */
export class FhirPathDecimalInput {
  private readonly copies = new WeakMap<object, unknown>();
  private readonly originals = new WeakMap<object, object>();

  constructor(private readonly version: 'R4' | 'R5' | 'R6', private readonly rootType?: string) {}

  project<T>(value: T): T {
    return this.visit(value, this.rootType ? createSchemaCursor(this.rootType, this.version) : undefined) as T;
  }

  conformance(lookup?: ProfileConformanceLookup): ProfileConformanceLookup | undefined {
    return lookup ? (node, url) => lookup(this.originals.get(node) ?? node, url) : undefined;
  }

  private visit(value: unknown, cursor?: SchemaCursor, owner?: object, key?: string, type?: string, depth = 0): unknown {
    if (typeof value === 'number') {
      const lexical = owner && key !== undefined ? numberSource(owner, key, value) : undefined;
      if (lexical !== undefined) return fhirpath.FP_Decimal.getDecimal(lexical);
      return type === 'decimal' && Number.isFinite(value) ? unavailableDecimal(value) : value;
    }
    if (!value || typeof value !== 'object') return value;
    const existing = this.copies.get(value);
    if (existing !== undefined) return existing;
    if (depth > 200) throw new Error('FHIRPath decimal input exceeded depth limit');
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      this.copies.set(value, output);
      this.originals.set(output, value);
      copyFhirPrimitiveContext(value, output);
      for (let index = 0; index < value.length; index++) {
        output.push(this.visit(value[index], cursor, value, String(index), type, depth + 1));
      }
      return output;
    }
    // Typed FHIRPath nodes and other library objects already have their own
    // semantics. Rebuilding them as plain objects destroys those semantics.
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const record = value as Record<string, unknown>;
    if (typeof record.resourceType === 'string') cursor = createSchemaCursor(record.resourceType, this.version);
    const output: Record<string, unknown> = {};
    this.copies.set(value, output);
    this.originals.set(output, value);
    copyFhirPrimitiveContext(value, output);
    for (const [property, child] of Object.entries(record)) {
      if (property === '__path__') continue;
      const resolved = resolveChild(cursor, property);
      Object.defineProperty(output, property, { enumerable: true, configurable: true, writable: true,
        value: this.visit(child, resolved?.next, record, property, resolved?.type, depth + 1) });
    }
    return output;
  }
}
