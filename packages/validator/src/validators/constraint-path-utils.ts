export function getEvaluationContext(resource: any, elementPath: string): any {
  const segments = elementPath.split('.');
  if (segments.length > 1 && segments[0] === resource.resourceType) segments.shift();
  if (segments.length === 0) return resource;

  let current: any = resource;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return resource;
    const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const fieldName = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      if (!current[fieldName] || !Array.isArray(current[fieldName])) return resource;
      if (index >= current[fieldName].length) return resource;
      current = current[fieldName][index];
    } else {
      let value = current[segment];
      if (value === undefined && segment.endsWith('[x]')) {
        const prefix = segment.slice(0, -3);
        const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
        if (actualKey) value = current[actualKey];
      }
      current = value;
    }
  }
  return current || resource;
}

export function elementExistsInResource(resource: any, elementPath: string): boolean {
  if (!resource || !elementPath) return false;
  const segments = elementPath.split('.');
  const resourceType = resource.resourceType;
  if (segments.length > 1 && segments[0] === resourceType) segments.shift();
  if (segments.length === 0) return true;

  let current: any = resource;
  for (const segment of segments) {
    const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const fieldName = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);

      if (!current[fieldName] || !Array.isArray(current[fieldName])) {
        return false;
      }
      if (index >= current[fieldName].length) {
        return false;
      }
      current = current[fieldName][index];
    } else {
      let value = current[segment];
      if ((value === undefined || value === null) && segment.endsWith('[x]')) {
        const prefix = segment.slice(0, -3);
        const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
        if (actualKey) value = current[actualKey];
      }
      if (value === undefined || value === null) {
        return false;
      }
      current = value;
    }
  }

  return true;
}

export function hasEmptyBackboneElement(resource: any, elementPath: string): boolean {
  if (!resource || !elementPath) return false;
  const segments = elementPath.split('.');
  if (segments.length > 1 && segments[0] === resource.resourceType) segments.shift();
  if (segments.length === 0) return false;

  let current: any = resource;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);

    if (arrayMatch) {
      const fieldName = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      if (!current[fieldName] || !Array.isArray(current[fieldName]) || index >= current[fieldName].length) {
        return false;
      }
      current = current[fieldName][index];
    } else {
      if (current[segment] === undefined || current[segment] === null) {
        return false;
      }
      current = current[segment];
    }
  }

  const lastSegment = segments[segments.length - 1];
  const value = current[lastSegment];

  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(item => {
      if (item === null || item === undefined) return false;
      if (typeof item !== 'object') return false;
      const keys = Object.keys(item);
      return keys.length === 0 || keys.every(k =>
        item[k] === undefined || item[k] === null ||
        (typeof item[k] === 'object' && Object.keys(item[k]).length === 0)
      );
    });
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length === 0;
  }

  return false;
}
