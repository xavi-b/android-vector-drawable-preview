import {
  ColorContext,
  Rgba,
  clamp01,
  formatNum,
  resolveColorValue,
  toCss,
  toCssRgb,
  withAlpha,
} from "./colors";
import { trimPathData } from "./pathTrim";
import { resolveDimensionDp } from "./resources";
import { Element } from "@xmldom/xmldom";
import { androidAttr, childElements, findFirst, localName, parseXml, plainAttr } from "./xmlUtil";

export interface RenderOptions {
  projectColors?: ReadonlyMap<string, string>;
  projectDimens?: ReadonlyMap<string, string>;
  themeAttrs?: ReadonlyMap<string, string>;
  darkTheme?: boolean;
  fileName?: string;
}

export interface VectorPreview {
  svg: string;
  warnings: string[];
  widthDp: number;
  heightDp: number;
  viewportWidth: number;
  viewportHeight: number;
  autoMirrored: boolean;
}

export type VectorRender = { ok: true; preview: VectorPreview } | { ok: false; error: string };

type Paint =
  | { kind: "none" }
  | { kind: "color"; css: string }
  | { kind: "gradient"; id: string; opacity: number }
  | { kind: "sweep"; stops: string; cx: number; cy: number; opacity: number };

interface StrokeStyle {
  paint: Paint;
  width: number;
  hairline: boolean;
  cap?: string;
  join?: string;
  miter?: string;
}

interface RenderContext extends ColorContext {
  vw: number;
  vh: number;
  projectDimens: ReadonlyMap<string, string>;
  warnings: string[];
  defs: string[];
  nextId: (prefix: string) => string;
  color: (value: string, label: string) => Rgba;
  trimmed: boolean;
  droppedContour: boolean;
  hairline: boolean;
}

const TINT_MODES = new Set(["src_in", "src_over", "src_atop", "multiply", "screen", "add"]);

export function isVectorDrawableXml(xml: string): boolean {
  return /<(?:[\w.-]+:)?vector\b/.test(xml) || /<(?:[\w.-]+:)?animated-vector\b/.test(xml);
}

export function externalDrawableReference(xml: string): string | undefined {
  const { document } = parseXml(xml);
  const root = document.documentElement;
  if (!root || localName(root) !== "animated-vector") return undefined;
  if (findFirst(root, "vector")) return undefined;
  const drawable = androidAttr(root, "drawable");
  if (!drawable) return undefined;
  return /^@(?:[A-Za-z0-9_.]+:)?\*?drawable\/([A-Za-z0-9_.]+)$/.exec(drawable.trim())?.[1];
}

export function renderVectorDrawable(xml: string, options: RenderOptions = {}): VectorRender {
  const source = xml.replace(/^\uFEFF/, "").trim();
  if (!source.includes("<")) return { ok: false, error: "The file is not XML." };

  const { document, errors } = parseXml(source);
  const root = document.documentElement;
  const vector = root && localName(root) !== "parsererror" ? findFirst(root, "vector") : undefined;
  if (!root || !vector) {
    return {
      ok: false,
      error: errors[0] ?? (root ? `No <vector> element found (root is <${localName(root)}>).` : "The XML could not be parsed."),
    };
  }

  const viewportWidth = Number(androidAttr(vector, "viewportWidth"));
  const viewportHeight = Number(androidAttr(vector, "viewportHeight"));
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
    return { ok: false, error: "Vector drawable needs a positive android:viewportWidth and android:viewportHeight." };
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  const palette: ColorContext = {
    projectColors: options.projectColors ?? new Map(),
    themeAttrs: options.themeAttrs ?? new Map(),
    darkTheme: options.darkTheme ?? false,
    warn: (message) => {
      if (seen.has(message)) return;
      seen.add(message);
      warnings.push(message);
    },
  };
  const ctx: RenderContext = {
    ...palette,
    vw: viewportWidth,
    vh: viewportHeight,
    projectDimens: options.projectDimens ?? new Map(),
    warnings,
    defs: [],
    trimmed: false,
    droppedContour: false,
    hairline: false,
    nextId: (() => {
      let n = 0;
      return (prefix: string) => `${prefix}${++n}`;
    })(),
    color: (value, label) => resolveColorValue(value, palette, label),
  };

  const rootName = localName(root);
  if (rootName === "animated-vector") {
    ctx.warn("Animated vector drawables are shown as a static image. Animation is not played.");
  } else if (rootName !== "vector") {
    ctx.warn(`Showing the first <vector> inside <${rootName}>.`);
  }

  const widthDp = dimensionOr(androidAttr(vector, "width"), viewportWidth, ctx);
  const heightDp = dimensionOr(androidAttr(vector, "height"), viewportHeight, ctx);
  const alpha = clamp01(numberAttr(vector, "alpha", 1, ctx));
  const autoMirrored = booleanAttr(vector, "autoMirrored", false, ctx);
  const content = renderNodes(childElements(vector), ctx);

  if (ctx.trimmed) ctx.warn("Trimmed paths are flattened to line segments.");
  if (ctx.droppedContour) ctx.warn("Path trim keeps only the first contour, matching Android.");
  if (ctx.hairline) ctx.warn("A stroke width of 0 is drawn as a 1px hairline, matching Android.");

  const tint = tintFilter(vector, ctx);
  const rootAttrs = ['data-root="1"'];
  if (tint) rootAttrs.push(`filter="url(#${tint})"`);
  if (alpha < 0.999) rootAttrs.push(`opacity="${formatNum(alpha)}"`);

  const title = escapeXml(options.fileName || "Vector drawable");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNum(viewportWidth)} ${formatNum(viewportHeight)}"`,
    ` width="${formatNum(widthDp)}" height="${formatNum(heightDp)}"`,
    ` data-viewport-width="${formatNum(viewportWidth)}" data-viewport-height="${formatNum(viewportHeight)}" overflow="hidden">`,
    `<title>${title}</title>`,
    `<defs><clipPath id="viewport"><rect x="0" y="0" width="${formatNum(viewportWidth)}" height="${formatNum(viewportHeight)}"/></clipPath>${ctx.defs.join("")}</defs>`,
    `<g ${rootAttrs.join(" ")}><g clip-path="url(#viewport)">${content}</g></g>`,
    `</svg>`,
  ].join("");

  return {
    ok: true,
    preview: {
      svg,
      warnings,
      widthDp,
      heightDp,
      viewportWidth,
      viewportHeight,
      autoMirrored,
    },
  };
}

function renderNodes(nodes: Element[], ctx: RenderContext): string {
  let html = "";
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const tag = localName(el);
    if (tag === "clip-path") {
      const data = androidAttr(el, "pathData");
      if (!data || !data.trim()) {
        ctx.warn("A clip-path has no android:pathData.");
        continue;
      }
      const id = ctx.nextId("clip");
      ctx.defs.push(`<clipPath id="${id}"><path d="${escapeXml(data)}"/></clipPath>`);
      return html + `<g clip-path="url(#${id})">${renderNodes(nodes.slice(i + 1), ctx)}</g>`;
    }
    if (tag === "path") html += renderPath(el, ctx);
    else if (tag === "group") html += renderGroup(el, ctx);
  }
  return html;
}

function renderGroup(el: Element, ctx: RenderContext): string {
  const transform = groupTransform(el, ctx);
  const inner = renderNodes(childElements(el), ctx);
  return transform ? `<g transform="${transform}">${inner}</g>` : `<g>${inner}</g>`;
}

function renderPath(el: Element, ctx: RenderContext): string {
  const authored = androidAttr(el, "pathData");
  if (!authored || !authored.trim()) {
    ctx.warn("A path has no android:pathData.");
    return "";
  }

  const pathData = trimmedPathData(el, authored, ctx);
  if (pathData === "") return "";

  const evenOdd = isEvenOdd(androidAttr(el, "fillType"));
  const fill = fillPaint(el, ctx);
  const stroke = strokeStyle(el, ctx);
  if (fill.kind === "none" && stroke.paint.kind === "none") {
    ctx.warn("A path has no fill or stroke, so it is invisible.");
    return "";
  }

  const name = androidAttr(el, "name");
  const parts: string[] = [];
  if (fill.kind === "sweep") parts.push(sweepLayer(ctx, pathData, fill, undefined, evenOdd));
  if (stroke.paint.kind === "sweep") parts.push(sweepLayer(ctx, pathData, stroke.paint, stroke, false));

  const drawnFill: Paint = fill.kind === "sweep" ? { kind: "none" } : fill;
  const drawnStroke: StrokeStyle =
    stroke.paint.kind === "sweep" ? { ...stroke, paint: { kind: "none" } } : stroke;
  if (drawnFill.kind !== "none" || drawnStroke.paint.kind !== "none") {
    parts.push(pathElement(pathData, name, drawnFill, drawnStroke, evenOdd));
  }
  return parts.join("");
}

function trimmedPathData(el: Element, authored: string, ctx: RenderContext): string {
  const start = numberAttr(el, "trimPathStart", 0, ctx);
  const end = numberAttr(el, "trimPathEnd", 1, ctx);
  const offset = numberAttr(el, "trimPathOffset", 0, ctx);
  if (start === 0 && end === 1) return authored;

  const trimmed = trimPathData(authored, start, end, offset);
  if (trimmed.error) {
    ctx.warn(`Could not apply path trim (${trimmed.error}). Showing the untrimmed path.`);
    return authored;
  }
  if (trimmed.droppedContours) ctx.droppedContour = true;
  if (trimmed.flattened) ctx.trimmed = true;
  return trimmed.pathData ?? authored;
}

function fillPaint(el: Element, ctx: RenderContext): Paint {
  const gradient = gradientChild(el, "fillColor");
  const alpha = clamp01(numberAttr(el, "fillAlpha", 1, ctx));
  if (gradient) return buildGradient(gradient, ctx, "path fill", alpha);
  const raw = androidAttr(el, "fillColor");
  if (raw == null) return { kind: "none" };
  return solidPaint(withAlpha(ctx.color(raw, "path fill"), alpha));
}

function strokeStyle(el: Element, ctx: RenderContext): StrokeStyle {
  const gradient = gradientChild(el, "strokeColor");
  const alpha = clamp01(numberAttr(el, "strokeAlpha", 1, ctx));
  let paint: Paint = { kind: "none" };
  if (gradient) paint = buildGradient(gradient, ctx, "path stroke", alpha);
  else {
    const raw = androidAttr(el, "strokeColor");
    if (raw != null) paint = solidPaint(withAlpha(ctx.color(raw, "path stroke"), alpha));
  }

  const width = numberAttr(el, "strokeWidth", 0, ctx);
  const hairline = paint.kind !== "none" && width <= 0;
  if (hairline) ctx.hairline = true;
  return {
    paint,
    width: width > 0 ? width : 0,
    hairline,
    cap: choiceAttr(el, "strokeLineCap", ["butt", "round", "square"], ctx),
    join: choiceAttr(el, "strokeLineJoin", ["miter", "round", "bevel"], ctx),
    miter: miterAttr(el, ctx),
  };
}

function pathElement(
  d: string,
  name: string | null,
  fill: Paint,
  stroke: StrokeStyle,
  evenOdd: boolean,
): string {
  const attrs: [string, string][] = [["d", d]];
  if (name) attrs.push(["data-android-name", name]);

  if (fill.kind === "color") attrs.push(["fill", fill.css]);
  else if (fill.kind === "gradient") {
    attrs.push(["fill", `url(#${fill.id})`]);
    if (fill.opacity < 0.999) attrs.push(["fill-opacity", formatNum(fill.opacity)]);
  } else attrs.push(["fill", "none"]);

  if (evenOdd && (fill.kind === "color" || fill.kind === "gradient")) attrs.push(["fill-rule", "evenodd"]);

  if (stroke.paint.kind === "color") attrs.push(["stroke", stroke.paint.css]);
  else if (stroke.paint.kind === "gradient") {
    attrs.push(["stroke", `url(#${stroke.paint.id})`]);
    if (stroke.paint.opacity < 0.999) attrs.push(["stroke-opacity", formatNum(stroke.paint.opacity)]);
  }

  if (stroke.paint.kind === "color" || stroke.paint.kind === "gradient") {
    if (stroke.hairline) {
      attrs.push(["stroke-width", "1"]);
      attrs.push(["vector-effect", "non-scaling-stroke"]);
    } else attrs.push(["stroke-width", formatNum(stroke.width)]);
    if (stroke.cap && stroke.cap !== "butt") attrs.push(["stroke-linecap", stroke.cap]);
    if (stroke.join && stroke.join !== "miter") attrs.push(["stroke-linejoin", stroke.join]);
    if (stroke.miter) attrs.push(["stroke-miterlimit", stroke.miter]);
  }

  return `<path ${attrs.map(([key, value]) => `${key}="${escapeXml(value)}"`).join(" ")}/>`;
}

function gradientChild(el: Element, paintName: string): Element | undefined {
  for (const child of childElements(el)) {
    if (localName(child) !== "attr") continue;
    const attrName = plainAttr(child, "name") ?? "";
    if (!attrName.endsWith(paintName)) continue;
    return childElements(child).find((grand) => localName(grand) === "gradient");
  }
  return undefined;
}

function buildGradient(grad: Element, ctx: RenderContext, label: string, opacity: number): Paint {
  if (opacity <= 0.001) return { kind: "none" };
  const stops = gradientStops(grad, ctx, label);
  if (stops.length === 0) {
    ctx.warn(`Gradient on ${label} has no colors.`);
    return { kind: "none" };
  }

  const type = (androidAttr(grad, "type") ?? "linear").toLowerCase();
  if (type === "sweep") {
    return {
      kind: "sweep",
      stops: conicStops(stops),
      cx: numberAttr(grad, "centerX", 0, ctx),
      cy: numberAttr(grad, "centerY", 0, ctx),
      opacity,
    };
  }

  if (type === "radial") {
    const radius = numberAttr(grad, "gradientRadius", 0, ctx);
    if (radius <= 0) {
      ctx.warn(`Radial gradient on ${label} has no radius. Painting the first color.`);
      return solidPaint(withAlpha(stops[0].color, opacity));
    }
    const id = ctx.nextId("grad");
    ctx.defs.push(
      `<radialGradient id="${id}" cx="${formatNum(numberAttr(grad, "centerX", 0, ctx))}" cy="${formatNum(numberAttr(grad, "centerY", 0, ctx))}" r="${formatNum(radius)}" gradientUnits="userSpaceOnUse"${spreadAttr(grad)}>${stopsMarkup(stops)}</radialGradient>`,
    );
    return { kind: "gradient", id, opacity };
  }

  if (type !== "linear") ctx.warn(`Unsupported gradient type "${type}" on ${label}. Drawing it as linear.`);
  const line = linearEndpoints(grad, ctx);
  if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < 1e-4) {
    ctx.warn(`Linear gradient on ${label} has zero length. Painting the first color.`);
    return solidPaint(withAlpha(stops[0].color, opacity));
  }
  const id = ctx.nextId("grad");
  ctx.defs.push(
    `<linearGradient id="${id}" x1="${formatNum(line.x1)}" y1="${formatNum(line.y1)}" x2="${formatNum(line.x2)}" y2="${formatNum(line.y2)}" gradientUnits="userSpaceOnUse"${spreadAttr(grad)}>${stopsMarkup(stops)}</linearGradient>`,
  );
  return { kind: "gradient", id, opacity };
}

function linearEndpoints(grad: Element, ctx: RenderContext): { x1: number; y1: number; x2: number; y2: number } {
  const names = ["startX", "startY", "endX", "endY"] as const;
  const explicit = names.some((name) => androidAttr(grad, name) != null);
  if (!explicit) {
    const angleRaw = androidAttr(grad, "angle");
    if (angleRaw != null) {
      const angle = Number(angleRaw);
      if (Number.isFinite(angle)) {
        const rad = (angle * Math.PI) / 180;
        const dx = Math.cos(rad);
        const dy = -Math.sin(rad);
        return {
          x1: ctx.vw / 2 - dx * (ctx.vw / 2),
          y1: ctx.vh / 2 - dy * (ctx.vh / 2),
          x2: ctx.vw / 2 + dx * (ctx.vw / 2),
          y2: ctx.vh / 2 + dy * (ctx.vh / 2),
        };
      }
    }
  }
  return {
    x1: numberAttr(grad, "startX", 0, ctx),
    y1: numberAttr(grad, "startY", 0, ctx),
    x2: numberAttr(grad, "endX", 0, ctx),
    y2: numberAttr(grad, "endY", 0, ctx),
  };
}

function gradientStops(grad: Element, ctx: RenderContext, label: string): { offset: number; color: Rgba }[] {
  const items = childElements(grad).filter((child) => localName(child) === "item");
  if (items.length > 0) {
    return items
      .map((item) => ({
        offset: clamp01(parseOffset(androidAttr(item, "offset") ?? "0")),
        color: ctx.color(androidAttr(item, "color") ?? "#00000000", `${label} gradient stop`),
      }))
      .sort((a, b) => a.offset - b.offset);
  }

  const stops: { offset: number; color: Rgba }[] = [];
  const start = androidAttr(grad, "startColor");
  const center = androidAttr(grad, "centerColor");
  const end = androidAttr(grad, "endColor");
  if (start) stops.push({ offset: 0, color: ctx.color(start, `${label} gradient`) });
  if (center) stops.push({ offset: 0.5, color: ctx.color(center, `${label} gradient`) });
  if (end) stops.push({ offset: 1, color: ctx.color(end, `${label} gradient`) });
  return stops;
}

function stopsMarkup(stops: { offset: number; color: Rgba }[]): string {
  const list = stops.length === 1 ? [stops[0], { offset: 1, color: stops[0].color }] : stops;
  return list.map((stop) => `<stop offset="${formatNum(stop.offset)}" stop-color="${toCss(stop.color)}"/>`).join("");
}

function conicStops(stops: { offset: number; color: Rgba }[]): string {
  const list = stops.length === 1 ? [stops[0], { offset: 1, color: stops[0].color }] : stops;
  return list.map((stop) => `${toCss(stop.color)} ${formatNum(stop.offset * 100)}%`).join(", ");
}

function spreadAttr(grad: Element): string {
  const mode = (androidAttr(grad, "tileMode") ?? "clamp").toLowerCase();
  if (mode === "repeat") return ` spreadMethod="repeat"`;
  if (mode === "mirror") return ` spreadMethod="reflect"`;
  return "";
}

function sweepLayer(
  ctx: RenderContext,
  d: string,
  sweep: Extract<Paint, { kind: "sweep" }>,
  stroke: StrokeStyle | undefined,
  evenOdd: boolean,
): string {
  const maskId = ctx.nextId("mask");
  const geometry = stroke
    ? `fill="none" stroke="white" ${strokeAttrs(stroke)}`
    : `fill="white" stroke="none"${evenOdd ? ' fill-rule="evenodd"' : ""}`;
  ctx.defs.push(
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000"><path d="${escapeXml(d)}" ${geometry}/></mask>`,
  );

  const pad = Math.max(ctx.vw, ctx.vh, 1);
  const minX = Math.min(0, sweep.cx) - pad;
  const minY = Math.min(0, sweep.cy) - pad;
  const maxX = Math.max(ctx.vw, sweep.cx) + pad;
  const maxY = Math.max(ctx.vh, sweep.cy) + pad;
  const opacity = sweep.opacity < 0.999 ? ` opacity="${formatNum(sweep.opacity)}"` : "";
  const atX = sweep.cx - minX;
  const atY = sweep.cy - minY;
  return `<foreignObject x="${formatNum(minX)}" y="${formatNum(minY)}" width="${formatNum(maxX - minX)}" height="${formatNum(maxY - minY)}" mask="url(#${maskId})"${opacity}><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:conic-gradient(from 90deg at ${formatNum(atX)}px ${formatNum(atY)}px, ${sweep.stops})"></div></foreignObject>`;
}

function strokeAttrs(stroke: StrokeStyle): string {
  const attrs = [
    `stroke-width="${stroke.hairline ? "1" : formatNum(stroke.width)}"`,
  ];
  if (stroke.hairline) attrs.push(`vector-effect="non-scaling-stroke"`);
  if (stroke.cap && stroke.cap !== "butt") attrs.push(`stroke-linecap="${stroke.cap}"`);
  if (stroke.join && stroke.join !== "miter") attrs.push(`stroke-linejoin="${stroke.join}"`);
  if (stroke.miter) attrs.push(`stroke-miterlimit="${stroke.miter}"`);
  return attrs.join(" ");
}

function solidPaint(color: Rgba): Paint {
  if (color.a <= 0.001) return { kind: "none" };
  return { kind: "color", css: toCss(color) };
}

function tintFilter(vector: Element, ctx: RenderContext): string | undefined {
  const raw = androidAttr(vector, "tint");
  if (raw == null || raw.trim() === "" || raw === "@null") return undefined;
  const color = ctx.color(raw, "android:tint");
  let mode = (androidAttr(vector, "tintMode") ?? "src_in").trim().toLowerCase();
  if (!TINT_MODES.has(mode)) {
    ctx.warn(`Unsupported android:tintMode "${mode}". Using src_in.`);
    mode = "src_in";
  }
  ctx.defs.push(tintFilterMarkup(color, mode, ctx.vw, ctx.vh));
  return "tint";
}

function tintFilterMarkup(color: Rgba, mode: string, vw: number, vh: number): string {
  const flood = `<feFlood flood-color="${toCssRgb(color)}" flood-opacity="${formatNum(color.a)}" result="tint"/>`;
  let body: string;
  switch (mode) {
    case "src_over":
      body = `${flood}<feComposite in="tint" in2="SourceGraphic" operator="over"/>`;
      break;
    case "src_atop":
      body = `${flood}<feComposite in="tint" in2="SourceGraphic" operator="atop"/>`;
      break;
    case "multiply":
      body = `${flood}<feBlend in="SourceGraphic" in2="tint" mode="multiply" result="blended"/><feComposite in="blended" in2="SourceAlpha" operator="in"/>`;
      break;
    case "screen":
      body = `${flood}<feBlend in="SourceGraphic" in2="tint" mode="screen" result="blended"/><feComposite in="blended" in2="SourceAlpha" operator="in"/>`;
      break;
    case "add":
      body = `${flood}<feBlend in="SourceGraphic" in2="tint" mode="plus" result="blended"/><feComposite in="blended" in2="SourceAlpha" operator="in"/>`;
      break;
    default:
      body = `${flood}<feComposite in="tint" in2="SourceAlpha" operator="in"/>`;
      break;
  }
  return `<filter id="tint" filterUnits="userSpaceOnUse" x="0" y="0" width="${formatNum(vw)}" height="${formatNum(vh)}" color-interpolation-filters="sRGB">${body}</filter>`;
}

/**
 * AOSP applies group transforms as translate-to-origin, scale, rotate, then translate back
 * plus the group's translation. SVG lists transforms from last to first.
 */
function groupTransform(el: Element, ctx: RenderContext): string | undefined {
  const rotation = numberAttr(el, "rotation", 0, ctx);
  const pivotX = numberAttr(el, "pivotX", 0, ctx);
  const pivotY = numberAttr(el, "pivotY", 0, ctx);
  const scaleX = numberAttr(el, "scaleX", 1, ctx);
  const scaleY = numberAttr(el, "scaleY", 1, ctx);
  const translateX = numberAttr(el, "translateX", 0, ctx);
  const translateY = numberAttr(el, "translateY", 0, ctx);

  if (rotation === 0 && scaleX === 1 && scaleY === 1) {
    if (translateX === 0 && translateY === 0) return undefined;
    return `translate(${formatNum(translateX)}, ${formatNum(translateY)})`;
  }

  const applied: string[] = [];
  if (pivotX !== 0 || pivotY !== 0) applied.push(`translate(${formatNum(-pivotX)}, ${formatNum(-pivotY)})`);
  if (scaleX !== 1 || scaleY !== 1) applied.push(`scale(${formatNum(scaleX)}, ${formatNum(scaleY)})`);
  if (rotation !== 0) applied.push(`rotate(${formatNum(rotation)})`);
  const finalX = translateX + pivotX;
  const finalY = translateY + pivotY;
  if (finalX !== 0 || finalY !== 0) applied.push(`translate(${formatNum(finalX)}, ${formatNum(finalY)})`);
  return applied.reverse().join(" ");
}

function dimensionOr(raw: string | null, fallback: number, ctx: RenderContext): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = resolveDimensionDp(raw, ctx.projectDimens, ctx.warn);
  if (value === undefined || !(value > 0)) return fallback;
  return value;
}

function numberAttr(el: Element, name: string, fallback: number, ctx: RenderContext): number {
  const raw = androidAttr(el, name);
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    ctx.warn(`Invalid number "${raw}" for android:${name}.`);
    return fallback;
  }
  return value;
}

function booleanAttr(el: Element, name: string, fallback: boolean, ctx: RenderContext): boolean {
  const raw = androidAttr(el, name);
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  ctx.warn(`Invalid boolean "${raw}" for android:${name}.`);
  return fallback;
}

function choiceAttr(el: Element, name: string, allowed: string[], ctx: RenderContext): string | undefined {
  const raw = androidAttr(el, name);
  if (raw == null || raw.trim() === "") return undefined;
  const value = raw.trim().toLowerCase();
  if (!allowed.includes(value)) {
    ctx.warn(`Unsupported android:${name} "${raw}".`);
    return undefined;
  }
  return value;
}

function miterAttr(el: Element, ctx: RenderContext): string | undefined {
  const raw = androidAttr(el, "strokeMiterLimit");
  if (raw == null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    ctx.warn(`Invalid number "${raw}" for android:strokeMiterLimit.`);
    return undefined;
  }
  if (Math.abs(value - 4) < 1e-6) return undefined;
  return formatNum(value);
}

function isEvenOdd(raw: string | null): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase().replace(/[_-]/g, "");
  return value === "evenodd" || value === "1";
}

function parseOffset(raw: string): number {
  const value = raw.trim();
  if (value.endsWith("%")) return Number(value.slice(0, -1)) / 100;
  return Number(value);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
