import { DOMParser, Document, Element } from "@xmldom/xmldom";

export const ANDROID_NS = "http://schemas.android.com/apk/res/android";

export function childElements(el: Element): Element[] {
  const out: Element[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (node && node.nodeType === 1) out.push(node as Element);
  }
  return out;
}

export function localName(el: Element): string {
  const raw = el.localName || el.nodeName || "";
  const colon = raw.indexOf(":");
  return colon >= 0 ? raw.slice(colon + 1) : raw;
}

export function androidAttr(el: Element, name: string): string | null {
  if (el.hasAttributeNS(ANDROID_NS, name)) {
    return el.getAttributeNS(ANDROID_NS, name);
  }
  const prefixed = `android:${name}`;
  if (el.hasAttribute(prefixed)) return el.getAttribute(prefixed);
  if (el.hasAttribute(name)) return el.getAttribute(name);
  return null;
}

export function plainAttr(el: Element, name: string): string | null {
  if (!el.hasAttribute(name)) return null;
  return el.getAttribute(name);
}

export function elementText(el: Element): string {
  return (el.textContent ?? "").trim();
}

export function hasAndroidStateAttr(el: Element): boolean {
  const attrs = el.attributes;
  if (!attrs) return false;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs.item(i);
    if (!attr) continue;
    const name = attr.name || "";
    const local = attr.localName || name;
    if (local.startsWith("state_") || name.includes(":state_")) return true;
  }
  return false;
}

export function parseXml(xml: string): { document: Document; errors: string[] } {
  const errors: string[] = [];
  try {
    const document = new DOMParser({
      onError: (level, message) => {
        if (level === "error" || level === "fatalError") errors.push(String(message));
      },
    }).parseFromString(xml.replace(/^\uFEFF/, ""), "text/xml");
    return { document, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!errors.includes(message)) errors.push(message);
    const document = new DOMParser({ onError: () => undefined }).parseFromString("<empty/>", "text/xml");
    return { document, errors };
  }
}

export function findFirst(el: Element, tag: string): Element | undefined {
  if (localName(el) === tag) return el;
  for (const child of childElements(el)) {
    const found = findFirst(child, tag);
    if (found) return found;
  }
  return undefined;
}
