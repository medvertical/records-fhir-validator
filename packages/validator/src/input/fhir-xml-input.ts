import { SaxesParser } from 'saxes';
import type { FhirInputDiagnostic, FhirInputLimits, ParsedFhirInput } from './fhir-input-types.js';
import {
  convertFhirXmlRoot,
  createXmlNode,
  FHIR_XML_NAMESPACE,
  XHTML_XML_NAMESPACE,
  type XmlNode,
} from './fhir-xml-node-converter.js';

const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export interface FhirXmlParseOptions {
  /**
   * FHIR release whose definitions decide primitive types and cardinality.
   * R4 and R5 disagree on roughly 200 elements, so passing the release the
   * document belongs to matters. Defaults to R4.
   */
  fhirVersion?: string;
}
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 200;
const DEFAULT_MAX_NODES = 1_000_000;

export function parseFhirXml(
  source: string,
  limits: FhirInputLimits = {},
  options: FhirXmlParseOptions = {},
): ParsedFhirInput {
  if (typeof source !== 'string') throw new Error('FHIR XML input must be a string');
  const maxBytes = positiveLimit(limits.maxBytes, DEFAULT_MAX_BYTES);
  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    throw new Error('FHIR XML input exceeded byte limit');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw new Error('FHIR XML DTD and entity declarations are not allowed');
  }

  const maxDepth = positiveLimit(limits.maxDepth, DEFAULT_MAX_DEPTH);
  const maxNodes = positiveLimit(limits.maxNodes, DEFAULT_MAX_NODES);
  const parser = new SaxesParser({ xmlns: true, position: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodeCount = 0;
  let parseError: Error | undefined;

  parser.on('doctype', () => {
    throw new Error('FHIR XML DTD declarations are not allowed');
  });
  parser.on('error', (error) => {
    parseError = error;
  });
  parser.on('opentag', (tag) => {
    if (tag.uri !== FHIR_XML_NAMESPACE && tag.uri !== XHTML_XML_NAMESPACE) {
      throw new Error(`FHIR XML contains unsupported namespace: ${tag.uri || '(empty)'}`);
    }
    if (tag.uri === FHIR_XML_NAMESPACE) {
      const foreignAttribute = Object.values(tag.attributes).find((attribute) =>
        attribute.uri !== '' && attribute.uri !== XMLNS_NAMESPACE,
      );
      if (foreignAttribute) {
        throw new Error(`FHIR XML contains unsupported attribute namespace: ${foreignAttribute.uri}`);
      }
    }
    nodeCount += 1;
    if (nodeCount > maxNodes) throw new Error('FHIR XML input exceeded node limit');
    if (stack.length >= maxDepth) throw new Error('FHIR XML input exceeded depth limit');
    const node = createXmlNode(tag, { line: parser.line, column: parser.column + 1 });
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(node);
      parent.content.push(node);
    } else if (root) {
      throw new Error('FHIR XML input must contain one root resource');
    } else {
      root = node;
    }
    stack.push(node);
  });
  parser.on('text', (text) => {
    stack.at(-1)?.content.push(text);
  });
  parser.on('cdata', (text) => {
    stack.at(-1)?.content.push(text);
  });
  parser.on('closetag', () => {
    stack.pop();
  });

  try {
    parser.write(source.replace(/^\uFEFF/, '')).close();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (parseError) throw parseError;
  if (!root) throw new Error('FHIR XML input contains no resource');
  if (root.uri !== FHIR_XML_NAMESPACE) {
    throw new Error('FHIR XML root must use the http://hl7.org/fhir namespace');
  }

  const sourceMap: ParsedFhirInput['sourceMap'] = {};
  const diagnostics: FhirInputDiagnostic[] = [];
  const resource = convertFhirXmlRoot(root, sourceMap, options.fhirVersion, diagnostics);
  return {
    format: 'xml',
    resources: [resource],
    sourceMap,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}
