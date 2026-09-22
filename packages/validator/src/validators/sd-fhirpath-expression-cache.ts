import fhirpath from 'fhirpath';

import { getFhirPathModel } from '../core/fhirpath-context.js';
import { rewriteCollectionTypeOperators } from './fhirpath-as-operator-rewrite.js';
import { logger } from '../logger.js';
import { VersionedExpressionCache } from './fhirpath-expression-cache-core.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

function compileSDFHIRPathExpression(expression: string, fhirVersion: 'R4' | 'R5' | 'R6') {
    return fhirpath.compile(
        rewriteCollectionTypeOperators(expression),
        getFhirPathModel(fhirVersion),
        { async: false },
    );
}

export type CompiledSDFHIRPathExpression = ReturnType<typeof compileSDFHIRPathExpression>;

export class SDFHIRPathExpressionCache extends
    VersionedExpressionCache<CompiledSDFHIRPathExpression | null> {
    constructor() {
        super({
            maxSize: 1000,
            keySeparator: ':',
            compile: compileSDFHIRPathExpression,
            onCompileError: (expression, error) => {
                logger.warn('[SDFHIRPathExecutor] Failed to compile expression', {
                    expressionLength: expression.length,
                    ...validationFailureMetadata(error),
                });
            },
            errorValue: () => null,
        });
    }
}
