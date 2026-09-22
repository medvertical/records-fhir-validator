import {
    fhirPathCustomFunctions,
    type FHIRPathContext,
} from './fhirpath-functions.js';
import type { CompiledSDFHIRPathExpression } from './sd-fhirpath-expression-cache.js';

type FHIRPathAdditionalOptions = NonNullable<Parameters<CompiledSDFHIRPathExpression>[2]>;
type LibraryInvocationTable = NonNullable<FHIRPathAdditionalOptions['userInvocationTable']>;

const INVOCATION_PARAMETER_TYPES = new Set([
    'Expr',
    'AnyAtRoot',
    'Identifier',
    'TypeSpecifier',
    'Any',
    'Integer',
    'Boolean',
    'Number',
    'String',
]);

export function createSDFHIRPathInvocationTable(context: FHIRPathContext): unknown {
    return {
        resolve: {
            // A regular function: fhirpath.js binds the evaluation context to
            // `this`, which typed-node wrapping of resolved resources needs.
            fn: function (this: unknown, inputs: unknown[]) {
                return fhirPathCustomFunctions.resolve.fn(inputs, context, this);
            },
            arity: { 0: [] },
        },
        memberOf: {
            fn: (inputs: unknown[], url: string) =>
                fhirPathCustomFunctions.memberOf.fn(inputs, url, context),
            arity: { 1: ['String'] },
        },
        conformsTo: {
            fn: (inputs: unknown[], url: string) =>
                fhirPathCustomFunctions.conformsTo.fn(inputs, url),
            arity: { 1: ['String'] },
        },
        extension: {
            fn: fhirPathCustomFunctions.extension.fn,
            arity: { 1: ['String'] },
        },
    };
}

/**
 * Evaluate a compiled FHIRPath expression synchronously. A timer cannot
 * interrupt synchronous evaluation on the same JavaScript thread.
 */
export function evaluateCompiledSDFHIRPath(
    compiled: CompiledSDFHIRPathExpression,
    context: unknown,
    rootResource: unknown,
    userInvocationTable?: unknown,
): unknown {
    const invocationTable = toFHIRPathInvocationTable(userInvocationTable);
    return compiled(
        context,
        {
            resource: rootResource,
            rootResource,
        },
        {
            traceFn: () => {},
            ...(invocationTable ? { userInvocationTable: invocationTable } : {}),
        },
    );
}

export function toFHIRPathInvocationTable(value: unknown): LibraryInvocationTable | undefined {
    return isFHIRPathInvocationTable(value) ? value : undefined;
}

function isFHIRPathInvocationTable(value: unknown): value is LibraryInvocationTable {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every(definition => {
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return false;
        const fn = Reflect.get(definition, 'fn');
        const arity = Reflect.get(definition, 'arity');
        if (typeof fn !== 'function' || !arity || typeof arity !== 'object' || Array.isArray(arity)) {
            return false;
        }
        return Object.entries(arity).every(([count, signature]) => (
            /^\d+$/.test(count)
            && Array.isArray(signature)
            && signature.every(parameter => (
                typeof parameter === 'string' && INVOCATION_PARAMETER_TYPES.has(parameter)
            ))
        ));
    });
}
