import type { SaxesAttributeNS, SaxesTagNS } from 'saxes';
import type { FhirInputDiagnostic, FhirInputLocation, ParsedFhirInput } from './fhir-input-types.js';
import { primitiveValue } from './fhir-xml-primitive-value.js';
import {
  PRIMITIVE_TYPE_NAMES,
  createSchemaCursor,
  cursorVersion,
  resolveChild,
  type SchemaCursor,
} from './fhir-xml-schema-cursor.js';

export const FHIR_XML_NAMESPACE = 'http://hl7.org/fhir';
export const XHTML_XML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const COMMON_REPEATING_ELEMENTS = new Set([
  'address', 'agent', 'alias', 'answer', 'author', 'basedOn', 'category', 'coding',
  'communication', 'component', 'constraint', 'contained', 'contact', 'diagnosis',
  'element', 'endpoint', 'entity', 'entry', 'extension', 'generalPractitioner', 'given',
  'identifier', 'image', 'imagingStudy', 'insurance', 'issue', 'item', 'line',
  'link', 'modifierExtension', 'note', 'parameter', 'participant',
  'performer', 'profile', 'reasonCode', 'reasonReference', 'referenceRange',
  'section', 'security', 'specialty', 'supportingInfo', 'tag', 'telecom',
]);
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const PRIMITIVE_CHOICE_ELEMENT = /^value(?:Base64Binary|Boolean|Canonical|Code|Date|DateTime|Decimal|Id|Instant|Integer|Integer64|Markdown|Oid|PositiveInt|String|Time|UnsignedInt|Uri|Url|Uuid)$/;

const REPEATING_PARENT_CHILD = new Set([
  'Encounter.location', 'Encounter.type', 'EpisodeOfCare.type',
  'HealthcareService.location', 'HealthcareService.type', 'Location.type',
  'Organization.type', 'Patient.name', 'Person.name', 'Practitioner.name',
  'PractitionerRole.location', 'RelatedPerson.name',
  'SubscriptionStatus.notificationEvent',
]);

export interface XmlNode {
  local: string;
  name: string;
  uri: string;
  attributes: Array<{ local: string; name: string; uri: string; value: string }>;
  children: XmlNode[];
  content: Array<XmlNode | string>;
  location: FhirInputLocation;
}

interface ConvertedNode {
  value: unknown;
  primitiveSidecar?: Record<string, unknown>;
}

export function createXmlNode(tag: SaxesTagNS, location: FhirInputLocation): XmlNode {
  return {
    local: tag.local,
    name: tag.name,
    uri: tag.uri,
    attributes: Object.values(tag.attributes).map((item: SaxesAttributeNS) => ({
      local: item.local,
      name: item.name,
      uri: item.uri,
      value: item.value,
    })),
    children: [],
    content: [],
    location,
  };
}

/** Attributes FHIR XML defines on an ordinary element. */
const ALLOWED_ATTRIBUTES = new Set(['value', 'id', 'url']);

export function convertFhirXmlRoot(
  root: XmlNode,
  sourceMap: ParsedFhirInput['sourceMap'],
  fhirVersion?: string,
  diagnostics?: FhirInputDiagnostic[],
): Record<string, unknown> {
  const cursor = createSchemaCursor(root.local, fhirVersion);
  const converted = convertNode(root, root.local, sourceMap, true, undefined, cursor, undefined, diagnostics);
  if (!converted.value || typeof converted.value !== 'object' || Array.isArray(converted.value)) {
    throw new Error('FHIR XML root did not normalize to a resource object');
  }
  return converted.value as Record<string, unknown>;
}

function convertNode(
  node: XmlNode,
  path: string,
  sourceMap: ParsedFhirInput['sourceMap'],
  rootResource = false,
  parentLocal?: string,
  cursor?: SchemaCursor,
  declaredType?: string,
  diagnostics?: FhirInputDiagnostic[],
): ConvertedNode {
  sourceMap[path] = node.location;
  // A narrative whose namespace is wrong is walked as if it were FHIR, so its
  // markup would otherwise be reported element by element as stray text. The
  // namespace itself is the defect and is reported on its own terms.
  const narrative = declaredType === 'xhtml';
  const collectInto = narrative ? undefined : diagnostics;
  if (collectInto && node.uri === FHIR_XML_NAMESPACE) {
    // An element the definitions do not describe is reported as undefined on
    // its own terms; also flagging whatever text it carries says the same
    // thing twice. `rootResource` covers the resource element itself, which
    // has no parent to have been resolved from.
    const known = rootResource || declaredType !== undefined;
    collectSerialisationDiagnostics(node, path, declaredType, collectInto, known);
  }
  if (node.uri === XHTML_XML_NAMESPACE && node.local === 'div') {
    return { value: serializeXml(node) };
  }
  if (
    (node.local === 'resource' || node.local === 'contained')
    && node.children.length === 1
    && node.children[0].uri === FHIR_XML_NAMESPACE
  ) {
    const inner = node.children[0];
    return convertNode(
      inner, path, sourceMap, true, node.local,
      createSchemaCursor(inner.local, cursorVersion(cursor)), undefined, collectInto,
    );
  }

  const rawValue = attribute(node, 'value');
  const id = attribute(node, 'id');
  const url = attribute(node, 'url');
  const buildSidecar = (): Record<string, unknown> => {
    const sidecar: Record<string, unknown> = {};
    if (id) sidecar.id = id;
    const elementCursor = cursor
      ? { table: cursor.table, type: 'Element', path: '' }
      : undefined;
    for (const child of node.children) {
      const resolved = resolveChild(elementCursor, child.local);
      const childConverted = convertNode(
        child, `${path}._${child.local}`, sourceMap, false, node.local,
        resolved?.next, resolved?.type, collectInto,
      );
      setProperty(
        sidecar, child.local, childConverted.value,
        resolved ? resolved.isArray : isRepeatingElement(node.local, child.local),
      );
    }
    return sidecar;
  };

  if (rawValue !== undefined) {
    const converted: ConvertedNode = {
      value: primitiveValue(parentLocal, node.local, rawValue, declaredType),
    };
    if (id || node.children.length > 0) converted.primitiveSidecar = buildSidecar();
    return converted;
  }

  // A primitive that carries no value but does carry an id or extensions. FHIR
  // JSON puts that content on the `_name` sibling and omits the value property
  // altogether. Walking it as a complex object instead produced "expected
  // boolean, found object" — on data-absent-reason, which is among the most
  // common extensions in real data, so this was not a corpus curiosity.
  if (
    ((declaredType !== undefined
      && declaredType !== 'xhtml'
      && PRIMITIVE_TYPE_NAMES.has(declaredType))
      // Untabled subtrees have no declared type; the choice-element spelling
      // still identifies a primitive there.
      || (declaredType === undefined && PRIMITIVE_CHOICE_ELEMENT.test(node.local)))
    && (id !== undefined || node.children.length > 0)
  ) {
    return { value: undefined, primitiveSidecar: buildSidecar() };
  }

  const output: Record<string, unknown> = {};
  if (rootResource) output.resourceType = node.local;
  if (id) output.id = id;
  if (url) output.url = url;
  for (const child of node.children) {
    const resolved = resolveChild(cursor, child.local);
    const forceArray = resolved ? resolved.isArray : isRepeatingElement(node.local, child.local);
    const existing = output[child.local];
    const index = Array.isArray(existing) ? existing.length : existing === undefined ? 0 : 1;
    const array = forceArray || existing !== undefined;
    const converted = convertNode(
      child, childPath(path, child.local, index, array), sourceMap, false, node.local,
      resolved?.next, resolved?.type, collectInto,
    );
    // An absent primitive value keeps its slot in a repeating element, because
    // the `_name` array is positional; as a singleton it has no slot at all.
    const valueAbsent = converted.value === undefined;
    const valueIndex = valueAbsent && !array
      ? 0
      : setProperty(output, child.local, valueAbsent ? null : converted.value, forceArray);
    const existingSidecar = output[`_${child.local}`];
    if (array && existingSidecar !== undefined && !Array.isArray(existingSidecar)) {
      output[`_${child.local}`] = [existingSidecar];
    }
    if (converted.primitiveSidecar) {
      setPrimitiveSidecar(output, child.local, converted.primitiveSidecar, valueIndex, array);
      sourceMap[childPath(path, `_${child.local}`, valueIndex, array)] = child.location;
    }
  }
  return { value: output };
}


function setProperty(output: Record<string, unknown>, name: string, value: unknown, forceArray: boolean): number {
  if (UNSAFE_PROPERTY_NAMES.has(name)) throw new Error(`FHIR XML contains unsafe element name: ${name}`);
  const current = output[name];
  if (current === undefined) {
    output[name] = forceArray ? [value] : value;
    return 0;
  }
  if (Array.isArray(current)) {
    current.push(value);
    return current.length - 1;
  }
  output[name] = [current, value];
  return 1;
}

function setPrimitiveSidecar(
  output: Record<string, unknown>,
  name: string,
  sidecar: Record<string, unknown>,
  index: number,
  array: boolean,
): void {
  const sidecarName = `_${name}`;
  if (!array) {
    setProperty(output, sidecarName, sidecar, false);
    return;
  }
  const current = output[sidecarName];
  const values: unknown[] = Array.isArray(current) ? current : current === undefined ? [] : [current];
  while (values.length < index) values.push(null);
  values[index] = sidecar;
  output[sidecarName] = values;
}

function collectSerialisationDiagnostics(
  node: XmlNode,
  path: string,
  declaredType: string | undefined,
  diagnostics: FhirInputDiagnostic[],
  known: boolean,
): void {
  // Only a leaf element. Text interleaved with child elements means the
  // element is being used as markup — a narrative whose namespace is wrong,
  // say — and that defect is reported on its own terms rather than as stray
  // text.
  if (known && node.children.length === 0) {
    for (const item of node.content) {
      if (typeof item !== 'string' || item.trim().length === 0) continue;
      diagnostics.push({
        code: 'xml-text-not-allowed',
        path,
        message: `Text should not be present ('${item.trim()}')`,
        location: node.location,
      });
      break;
    }
  }
  for (const attribute of node.attributes) {
    if (attribute.uri !== '') continue;
    if (ALLOWED_ATTRIBUTES.has(attribute.local)) {
      // An attribute written as `url=""` carries no value. The conversion
      // drops it, so afterwards it is indistinguishable from an attribute
      // that was never written at all.
      if (attribute.value.length === 0) {
        diagnostics.push({
          code: 'xml-attribute-empty',
          path,
          message: 'value cannot be empty',
          location: node.location,
        });
      }
      continue;
    }
    diagnostics.push({
      code: 'xml-attribute-undefined',
      path,
      message: `Undefined attribute '@${attribute.local}' on ${node.local}`
        + (declaredType ? ` for type ${declaredType}` : ''),
      location: node.location,
    });
  }
}

function attribute(node: XmlNode, local: string): string | undefined {
  return node.attributes.find((candidate) => candidate.local === local && candidate.uri === '')?.value;
}

function isRepeatingElement(parent: string, child: string): boolean {
  return COMMON_REPEATING_ELEMENTS.has(child) || REPEATING_PARENT_CHILD.has(`${parent}.${child}`);
}

function childPath(parentPath: string, name: string, index: number, array: boolean): string {
  return `${parentPath}.${name}${array ? `[${index}]` : ''}`;
}

function serializeXml(node: XmlNode): string {
  const attributes = node.attributes
    .map((item) => ` ${item.name}="${escapeAttribute(item.value)}"`)
    .join('');
  const content = node.content
    .map((item) => typeof item === 'string' ? escapeText(item) : serializeXml(item))
    .join('');
  return content
    ? `<${node.name}${attributes}>${content}</${node.name}>`
    : `<${node.name}${attributes}/>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}
