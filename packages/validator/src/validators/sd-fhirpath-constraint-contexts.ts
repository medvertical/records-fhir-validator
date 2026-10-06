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
    isRootConstraint: boolean,
    elementContextResolver: ElementContextResolver,
): ConstraintTarget[] {
    if (isRootConstraint) {
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
