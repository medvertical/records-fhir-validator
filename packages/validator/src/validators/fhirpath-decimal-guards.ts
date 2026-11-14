import fhirpath from 'fhirpath';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { assertDecimalSourceAvailable } from './fhirpath-decimal-input.js';
import { comparisonValues } from './fhirpath-primitive-comparison.js';

type Compiled = ReturnType<typeof fhirpath.compile<{ async: false; resolveInternalTypes: false }>>;
type InvocationTable = NonNullable<NonNullable<Parameters<Compiled>[2]>['userInvocationTable']>;
type Version = 'R4' | 'R5' | 'R6';
type FunctionName = 'toString' | 'lowBoundary' | 'highBoundary';
const builtins = new Map<string, Compiled>();

function invokeBuiltin(name: FunctionName, inputs: unknown[], version: Version, precision?: unknown): unknown {
  const key = `${version}:${name}:${precision === undefined ? '0' : '1'}`;
  let compiled = builtins.get(key);
  if (!compiled) {
    compiled = fhirpath.compile(`${name}(${precision === undefined ? '' : '%precision'})`,
      getFhirPathModel(version), { async: false, preciseMath: true, resolveInternalTypes: false });
    builtins.set(key, compiled);
  }
  return compiled(inputs, precision === undefined ? {} : { precision }, { traceFn() {} });
}

/** Check only source-dependent functions; quantity construction and arithmetic remain executable. */
export function withDecimalSourceGuards(table: InvocationTable | undefined, version: Version): InvocationTable {
  const boundary = (name: 'lowBoundary' | 'highBoundary'): InvocationTable[string] => ({
    fn: (inputs: unknown[], precision?: unknown) => {
      assertDecimalSourceAvailable(inputs);
      return invokeBuiltin(name, inputs, version, precision);
    }, arity: { 0: [], 1: ['Integer'] }, internalStructures: true,
  });
  return {
    recordsComparisonValue: { fn: comparisonValues, arity: { 0: [] }, internalStructures: true },
    toString: { fn: (inputs: unknown[]) => {
      assertDecimalSourceAvailable(inputs);
      return invokeBuiltin('toString', inputs, version);
    }, arity: { 0: [] }, internalStructures: true },
    lowBoundary: boundary('lowBoundary'), highBoundary: boundary('highBoundary'),
    ...table,
  };
}
