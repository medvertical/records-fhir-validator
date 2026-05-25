export function extractReferencesFromResource(resource: any): string[] {
  const references: string[] = [];

  const visit = (obj: any) => {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (obj.reference && typeof obj.reference === 'string') {
      references.push(obj.reference);
    }

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        value.forEach(item => visit(item));
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };

  visit(resource);
  return references;
}

export function extractReferencesFromBundle(bundle: any): string[] {
  if (!Array.isArray(bundle?.entry)) {
    return [];
  }

  return bundle.entry.flatMap((entry: any) =>
    entry?.resource ? extractReferencesFromResource(entry.resource) : []
  );
}
