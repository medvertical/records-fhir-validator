import type { ElementContextResolver } from './element-context-resolver.js';

export interface ConstraintTarget {
    context: unknown;
    path: string;
    checkHtml: boolean;
}

export function getCollectedConstraintTargets(
    resource: unknown,
    resourceType: string,
    elementPath: string,
    expression: string,
    isRootConstraint: boolean,
    expressionStartsAtResourceRoot: (expression: string | undefined, resourceType: string) => boolean,
    elementContextResolver: ElementContextResolver,
): ConstraintTarget[] {
    if (isRootConstraint || expressionStartsAtResourceRoot(expression, resourceType)) {
        return [{ context: resource, path: elementPath, checkHtml: isRootConstraint }];
    }
    return elementContextResolver
        .resolveContexts(resource, elementPath, resourceType)
        .map(context => ({
            context: context.value,
            path: context.fullPath,
            checkHtml: true,
        }));
}
