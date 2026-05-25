export function expressionStartsAtResourceRoot(expression: string | undefined, resourceType: string): boolean {
  if (!expression || !resourceType) return false;
  const escapedResourceType = resourceType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:\\(\\s*)*${escapedResourceType}(?=\\.|\\b)`).test(expression);
}

export function getThisCastType(expression: string): string | null {
  const match = expression.match(/\$this\s+as\s+([A-Za-z][A-Za-z0-9]*)/);
  return match?.[1]?.toLowerCase() ?? null;
}

export function choiceContextHasOnlyOtherTypes(ctx: any, choiceElementName: string, castType: string): boolean {
  const choiceTypes = getChoiceTypesInContext(ctx, choiceElementName);
  return choiceTypes.length > 0 && choiceTypes.every(choiceType => choiceType !== castType.toLowerCase());
}

export function hasUnresolvableChoiceTypes(ctx: any, expression: string): boolean {
  const choiceBases = [
    'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
    'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
    'product', 'serviced', 'location', 'allowed', 'used',
    'rate', 'born', 'age',
  ];
  const keys = Object.keys(ctx);
  for (const base of choiceBases) {
    if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
    if (ctx[base] !== undefined) continue;
    if (keys.some(k => k.startsWith(base) && k.length > base.length && k[base.length] === k[base.length].toUpperCase())) {
      return true;
    }
  }
  return false;
}

function getChoiceTypesInContext(ctx: any, choiceElementName: string): string[] {
  if (Array.isArray(ctx)) {
    return ctx.flatMap(item => getChoiceTypesInContext(item, choiceElementName));
  }

  if (!ctx || typeof ctx !== 'object') return [];

  return Object.keys(ctx)
    .filter(key =>
      key.startsWith(choiceElementName) &&
      key.length > choiceElementName.length &&
      key[choiceElementName.length] === key[choiceElementName.length].toUpperCase()
    )
    .map(key => key.slice(choiceElementName.length).toLowerCase());
}
