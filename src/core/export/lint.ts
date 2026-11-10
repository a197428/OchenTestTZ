import { DOMParser } from '@xmldom/xmldom';
import type { Document, Element } from '@xmldom/xmldom';

export interface LintOptions {
  width: number;
  height: number;
  idPrefix?: string;
  allowedD?: ReadonlySet<string>;
}

export interface LintResult {
  ok: boolean;
  errors: string[];
}

const ALLOWED_TAGS = new Set(['svg', 'g', 'defs', 'clipPath', 'rect', 'path', 'line']);
const FORBIDDEN_ATTRIBUTES = new Set([
  'class',
  'style',
  'filter',
  'mask',
  'href',
  'xlink:href',
  'marker-start',
  'marker-mid',
  'marker-end',
]);
const COLOR_ATTRIBUTES = new Set(['fill', 'stroke']);

export function lintExport(svg: string, options: LintOptions): LintResult {
  const errors: string[] = [];
  const prefix = options.idPrefix ?? 'ic1-';
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;

  if (!root || root.tagName !== 'svg') {
    return { ok: false, errors: ['Root element is not <svg>'] };
  }

  checkRoot(root, options, errors);
  const ids = new Set<string>();
  let clipReferences = 0;

  walk(document, (element) => {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      errors.push(`Forbidden element <${element.tagName}>`);
      return;
    }

    const id = element.getAttribute('id');
    if (id) {
      if (!id.startsWith(prefix)) errors.push(`Id "${id}" does not start with ${prefix}`);
      if (ids.has(id)) errors.push(`Duplicate id "${id}"`);
      ids.add(id);
    }

    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes[index];
      if (!attribute) continue;
      const name = attribute.name;
      const value = attribute.value;
      if (FORBIDDEN_ATTRIBUTES.has(name)) {
        errors.push(`Forbidden attribute ${name} on <${element.tagName}>`);
      }
      if (COLOR_ATTRIBUTES.has(name) && !isAllowedColor(value)) {
        errors.push(`Color "${value}" must be a #RRGGBB value or none`);
      }
      if (name === 'clip-path') {
        clipReferences++;
        if (value !== `url(#${prefix}frame)`) {
          errors.push(`Unexpected clip-path reference: ${value}`);
        }
      }
      if (value.includes('url(') && name !== 'clip-path') {
        errors.push(`Unexpected url() reference in ${name}`);
      }
    }

    if (element.tagName === 'path') {
      const d = element.getAttribute('d');
      if (!d) {
        errors.push('Path without d attribute');
      } else if (options.allowedD && !options.allowedD.has(d)) {
        errors.push(`Path d is not byte-identical to the catalog (${d.slice(0, 24)}...)`);
      }
      if (!element.getAttribute('fill') && !element.getAttribute('stroke')) {
        errors.push('Path has neither fill nor stroke');
      }
    }
  });

  if (clipReferences !== 1) {
    errors.push(`Expected exactly one clip-path reference, found ${clipReferences}`);
  }
  const clipPath = findById(root, `${prefix}frame`, 'clipPath');
  if (!clipPath) {
    errors.push(`Missing clipPath #${prefix}frame`);
  } else if (clipPath.getElementsByTagName('rect').length === 0) {
    errors.push('Frame clipPath has no rect');
  }

  if (!svg.includes(`id="${prefix}background"`)) {
    errors.push('Missing background rect');
  }
  if (/<image\b|<foreignObject\b|<filter\b|<mask\b|<style\b|<use\b|<linearGradient\b/i.test(svg)) {
    errors.push('Export contains a raster or unsupported element');
  }

  return { ok: errors.length === 0, errors };
}

function checkRoot(root: Element, options: LintOptions, errors: string[]): void {
  if (root.getAttribute('xmlns') !== 'http://www.w3.org/2000/svg') {
    errors.push('Missing SVG namespace');
  }
  const width = Number(root.getAttribute('width'));
  const height = Number(root.getAttribute('height'));
  if (width !== options.width || height !== options.height) {
    errors.push(`Size mismatch: ${width}x${height}, expected ${options.width}x${options.height}`);
  }
  const viewBox = root.getAttribute('viewBox');
  if (viewBox !== `0 0 ${options.width} ${options.height}`) {
    errors.push(`Invalid viewBox: ${viewBox ?? 'none'}`);
  }
}

function isAllowedColor(value: string): boolean {
  return value === 'none' || /^#[0-9A-F]{6}$/i.test(value);
}

function walk(document: Document, visit: (element: Element) => void): void {
  const visitChildren = (node: Document | Element): void => {
    for (let index = 0; index < node.childNodes.length; index++) {
      const child = node.childNodes.item(index);
      if (!child || child.nodeType !== 1) continue;
      const element = child as Element;
      visit(element);
      visitChildren(element);
    }
  };
  visitChildren(document);
}

function findById(root: Element, id: string, tag: string): Element | null {
  let found: Element | null = null;
  const search = (element: Element): void => {
    if (found) return;
    if (element.tagName === tag && element.getAttribute('id') === id) {
      found = element;
      return;
    }
    for (let index = 0; index < element.childNodes.length; index++) {
      const child = element.childNodes.item(index);
      if (child && child.nodeType === 1) search(child as Element);
    }
  };
  search(root);
  return found;
}
