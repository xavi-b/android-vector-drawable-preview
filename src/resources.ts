import fs from "node:fs/promises";
import path from "node:path";
import { Element } from "@xmldom/xmldom";
import { parseHexColor, withAlpha } from "./colors";
import { androidAttr, childElements, elementText, hasAndroidStateAttr, localName, parseXml, plainAttr } from "./xmlUtil";

export interface StyleDef {
  parent?: string;
  items: Map<string, string>;
}

export interface ProjectResources {
  colors: Map<string, string>;
  dimens: Map<string, string>;
  themeAttrs: Map<string, string>;
  warnings: string[];
}

interface ResourceBag {
  colors: Map<string, string>;
  dimens: Map<string, string>;
  styles: Map<string, StyleDef>;
}

const SKIP_VALUES_FILE =
  /^(strings|plurals|arrays|ids|attrs|attr|bools|integers|fractions|donottranslate|public|file_paths|network_security_config|config)/i;

const DENSITY_QUALIFIERS = new Set([
  "ldpi",
  "mdpi",
  "hdpi",
  "xhdpi",
  "xxhdpi",
  "xxxhdpi",
  "tvdpi",
  "nodpi",
  "anydpi",
]);

export async function loadProjectResources(startFile: string, night: boolean): Promise<ProjectResources> {
  const warnings: string[] = [];
  const bag: ResourceBag = { colors: new Map(), dimens: new Map(), styles: new Map() };
  const resDir = await findResDir(startFile);
  if (!resDir) {
    return { colors: bag.colors, dimens: bag.dimens, themeAttrs: new Map(), warnings };
  }

  await loadQualifiedXml(resDir, "values", night, warnings, async (file, label) => {
    const xml = await readText(file);
    if (xml === undefined) {
      warnings.push(`Could not read ${label}.`);
      return;
    }
    absorbValuesXml(xml, bag);
  });

  await loadQualifiedXml(resDir, "color", night, warnings, async (file, label) => {
    const xml = await readText(file);
    if (xml === undefined) {
      warnings.push(`Could not read ${label}.`);
      return;
    }
    const color = parseColorStateList(xml);
    if (color) bag.colors.set(path.basename(file, ".xml"), color);
  });

  const themeName = await readManifestTheme(resDir);
  return {
    colors: bag.colors,
    dimens: bag.dimens,
    themeAttrs: resolveTheme(bag.styles, themeName),
    warnings,
  };
}

export async function findResDir(startFile: string): Promise<string | undefined> {
  let dir = path.dirname(startFile);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, "res");
    if (await isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function findDrawableFile(resDir: string, name: string, night: boolean): Promise<string | undefined> {
  const entries = await readDir(resDir);
  let best: { file: string; score: number } | undefined;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const score = drawableScore(entry.name, night);
    if (score === undefined) continue;
    const file = path.join(resDir, entry.name, `${name}.xml`);
    if (!(await isFile(file))) continue;
    if (!best || score > best.score || (score === best.score && file < best.file)) {
      best = { file, score };
    }
  }
  return best?.file;
}

export function absorbValuesXml(xml: string, bag: ResourceBag): void {
  const { document } = parseXml(xml);
  const root = document.documentElement;
  if (!root) return;
  walkResources(root, bag);
}

export function parseColorStateList(xml: string): string | undefined {
  const { document } = parseXml(xml);
  const root = document.documentElement;
  if (!root || localName(root) !== "selector") return undefined;

  let fallback: string | undefined;
  let stateless: string | undefined;
  for (const item of childElements(root)) {
    if (localName(item) !== "item") continue;
    const color = androidAttr(item, "color");
    if (!color) continue;
    const value = applySelectorAlpha(color, androidAttr(item, "alpha"));
    fallback = value;
    if (!hasAndroidStateAttr(item)) stateless = value;
  }
  return stateless ?? fallback;
}

export function parseManifestTheme(xml: string): string | undefined {
  const { document } = parseXml(xml);
  const root = document.documentElement;
  if (!root) return undefined;
  const application = childElements(root).find((el) => localName(el) === "application");
  if (!application) return undefined;
  const theme = androidAttr(application, "theme");
  if (!theme) return undefined;
  return normalizeStyleRef(theme);
}

export function resolveTheme(styles: ReadonlyMap<string, StyleDef>, themeName: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!themeName) return out;
  const seen = new Set<string>();

  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const style = styles.get(name);
    if (!style) return;
    const parent = parentStyleName(style, name, styles);
    if (parent) visit(parent);
    for (const [key, value] of style.items) addThemeItem(out, key, value);
  };

  visit(themeName);
  return out;
}

export function resolveDimensionDp(
  raw: string,
  dimens: ReadonlyMap<string, string>,
  warn: (message: string) => void,
  stack: string[] = [],
): number | undefined {
  const value = raw.trim();
  const direct = parseDimensionDp(value);
  if (direct !== undefined) return direct;

  const ref = /^@(?:[A-Za-z0-9_.]+:)?\*?dimen\/([A-Za-z0-9_.]+)$/.exec(value);
  if (ref) {
    const name = ref[1];
    const key = `@dimen/${name}`;
    if (stack.includes(key)) {
      warn(`Dimension reference cycle at ${key}.`);
      return undefined;
    }
    const next = dimens.get(name);
    if (next === undefined) {
      warn(`Unresolved @dimen/${name}.`);
      return undefined;
    }
    return resolveDimensionDp(next, dimens, warn, [...stack, key]);
  }

  if (/^@\*?android:dimen\//.test(value)) {
    warn(`Unresolved ${value}.`);
    return undefined;
  }
  warn(`Unrecognized dimension "${value}".`);
  return undefined;
}

export function parseDimensionDp(raw: string): number | undefined {
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(dp|dip|px|sp|pt|in|mm)?$/i.exec(raw.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  switch ((match[2] ?? "dp").toLowerCase()) {
    case "dp":
    case "dip":
    case "px":
    case "sp":
      return amount;
    case "pt":
      return (amount * 160) / 72;
    case "in":
      return amount * 160;
    case "mm":
      return (amount * 160) / 25.4;
    default:
      return undefined;
  }
}

function walkResources(el: Element, bag: ResourceBag): void {
  const tag = localName(el);
  if (tag === "style") {
    absorbStyle(el, bag);
    return;
  }
  if (tag === "color") {
    const name = plainAttr(el, "name");
    const value = elementText(el);
    if (name && value) bag.colors.set(name, value);
  } else if (tag === "dimen") {
    const name = plainAttr(el, "name");
    const value = elementText(el);
    if (name && value) bag.dimens.set(name, value);
  } else if (tag === "item") {
    const type = plainAttr(el, "type");
    const name = plainAttr(el, "name");
    const value = elementText(el);
    if (name && value && type === "color") bag.colors.set(name, value);
    if (name && value && type === "dimen") bag.dimens.set(name, value);
  }
  for (const child of childElements(el)) walkResources(child, bag);
}

function absorbStyle(el: Element, bag: ResourceBag): void {
  const name = plainAttr(el, "name");
  if (!name) return;
  const parentAttr = plainAttr(el, "parent");
  const items = new Map<string, string>();
  for (const child of childElements(el)) {
    if (localName(child) !== "item") continue;
    const itemName = plainAttr(child, "name");
    const value = elementText(child);
    if (itemName && value) items.set(itemName, value);
  }

  const existing = bag.styles.get(name);
  if (!existing) {
    bag.styles.set(name, parentAttr === null ? { items } : { parent: parentAttr, items });
    return;
  }
  if (parentAttr !== null) existing.parent = parentAttr;
  for (const [key, value] of items) existing.items.set(key, value);
}

function parentStyleName(
  style: StyleDef,
  name: string,
  styles: ReadonlyMap<string, StyleDef>,
): string | undefined {
  if (style.parent !== undefined && style.parent.trim() !== "") {
    const normalized = normalizeStyleRef(style.parent);
    if (normalized && styles.has(normalized)) return normalized;
    return undefined;
  }
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const implicit = name.slice(0, dot);
    if (styles.has(implicit)) return implicit;
  }
  return undefined;
}

function normalizeStyleRef(ref: string): string | undefined {
  const value = ref.trim();
  if (value.startsWith("@android:style/") || value.startsWith("@*android:style/")) return undefined;
  const namespaced = /^@(?:[A-Za-z0-9_.]+:)?style\/(.+)$/.exec(value);
  if (namespaced) return namespaced[1];
  if (value.startsWith("@") || value.startsWith("?")) return undefined;
  return value;
}

function addThemeItem(map: Map<string, string>, name: string, value: string): void {
  map.set(name, value);
  const colon = name.indexOf(":");
  if (colon >= 0) map.set(name.slice(colon + 1), value);
}

function applySelectorAlpha(color: string, alpha: string | null): string {
  if (alpha == null || alpha.trim() === "") return color;
  const factor = Number(alpha);
  if (!Number.isFinite(factor)) return color;
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  const combined = withAlpha(parsed, factor);
  const channel = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${channel(combined.a * 255)}${channel(combined.r)}${channel(combined.g)}${channel(combined.b)}`;
}

async function loadQualifiedXml(
  resDir: string,
  prefix: "values" | "color",
  night: boolean,
  warnings: string[],
  readFile: (file: string, label: string) => Promise<void>,
): Promise<void> {
  const entries = await readDir(resDir);
  const folders: { name: string; rank: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ranked = qualifierRank(entry.name, prefix, night);
    if (ranked === undefined) continue;
    folders.push({ name: entry.name, rank: ranked });
  }
  folders.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  for (const folder of folders) {
    const dir = path.join(resDir, folder.name);
    const files = await readDir(dir);
    const xmlFiles = files
      .filter((file) => file.isFile() && file.name.endsWith(".xml") && !SKIP_VALUES_FILE.test(file.name))
      .map((file) => file.name)
      .sort();
    for (const name of xmlFiles) {
      const file = path.join(dir, name);
      try {
        const stat = await fs.stat(file);
        if (stat.size > 1_000_000) continue;
      } catch {
        continue;
      }
      await readFile(file, `${prefix}/${name}`);
    }
  }
  if (warnings.length > 100) warnings.length = 100;
}

function qualifierRank(folder: string, prefix: string, night: boolean): number | undefined {
  if (folder !== prefix && !folder.startsWith(`${prefix}-`)) return undefined;
  const quals = folder === prefix ? [] : folder.slice(prefix.length + 1).split("-").filter(Boolean);
  let isNight = false;
  let isNotNight = false;
  let api = 0;
  for (const qualifier of quals) {
    if (qualifier === "night") isNight = true;
    else if (qualifier === "notnight") isNotNight = true;
    else if (/^v\d+$/.test(qualifier)) api = Number(qualifier.slice(1));
    else return undefined;
  }
  if (isNight && isNotNight) return undefined;
  if (!night && isNight) return undefined;
  if (night && isNotNight) return undefined;
  return api + (isNight ? 10_000 : 0);
}

function drawableScore(folder: string, night: boolean): number | undefined {
  if (folder !== "drawable" && !folder.startsWith("drawable-")) return undefined;
  const quals = folder === "drawable" ? [] : folder.slice("drawable-".length).split("-").filter(Boolean);
  let score = 0;
  let isNight = false;
  let isNotNight = false;
  for (const qualifier of quals) {
    if (qualifier === "night") isNight = true;
    else if (qualifier === "notnight") isNotNight = true;
    else if (qualifier === "anydpi") score += 20;
    else if (DENSITY_QUALIFIERS.has(qualifier)) score += 1;
    else if (/^v\d+$/.test(qualifier)) score += Number(qualifier.slice(1)) / 10_000;
    else return undefined;
  }
  if (!night && isNight) return undefined;
  if (night && isNotNight) return undefined;
  if (night && isNight) score += 50;
  return score;
}

async function readManifestTheme(resDir: string): Promise<string | undefined> {
  const manifestPath = path.join(path.dirname(resDir), "AndroidManifest.xml");
  const xml = await readText(manifestPath);
  if (!xml) return undefined;
  return parseManifestTheme(xml);
}

async function readDir(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
