export interface TrimResult {
  /** Null keeps the authored path data. An empty string draws nothing. */
  pathData: string | null;
  flattened: boolean;
  droppedContours: boolean;
  error?: string;
}

interface Pt {
  x: number;
  y: number;
}

interface Subpath {
  points: Pt[];
}

const FLATNESS = 0.05;

/**
 * Applies Android's trimPathStart/End/Offset.
 * A start of 0 and an end of 1 leaves the path untouched, including when an offset is set.
 * That matches `applyTrim` in AOSP `VectorDrawable.cpp`, which returns before reading the offset.
 * Negative offsets wrap into [0, 1).
 */
export function trimPathData(d: string, start: number, end: number, offset: number): TrimResult {
  if (start === 0 && end === 1) {
    return { pathData: null, flattened: false, droppedContours: false };
  }

  const startT = mod1(start + offset);
  const endT = mod1(end + offset);
  if (Math.abs(startT - endT) < 1e-6) {
    return { pathData: "", flattened: true, droppedContours: false };
  }

  let subpaths: Subpath[];
  try {
    subpaths = flattenPath(d);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pathData: null, flattened: false, droppedContours: false, error: message };
  }

  const droppedContours = subpaths.length > 1;
  const contour = subpaths[0];
  if (!contour || contour.points.length < 2) {
    return { pathData: "", flattened: true, droppedContours };
  }

  const length = polylineLength(contour.points);
  if (length <= 1e-6) {
    return { pathData: "", flattened: true, droppedContours };
  }

  const slices: Pt[][] = [];
  if (startT > endT) {
    slices.push(slicePolyline(contour.points, startT * length, length));
    if (endT > 0) slices.push(slicePolyline(contour.points, 0, endT * length));
  } else {
    slices.push(slicePolyline(contour.points, startT * length, endT * length));
  }

  return {
    pathData: slicesToPath(slices),
    flattened: true,
    droppedContours,
  };
}

export function measureFirstContour(d: string): number {
  const subpaths = flattenPath(d);
  const contour = subpaths[0];
  if (!contour) return 0;
  return polylineLength(contour.points);
}

function mod1(value: number): number {
  const r = value % 1;
  return r < 0 ? r + 1 : r;
}

function flattenPath(d: string): Subpath[] {
  const subpaths: Subpath[] = [];
  let current: Subpath | undefined;
  let cx = 0;
  let cy = 0;
  let prevCurve: "C" | "Q" | "none" = "none";
  let lastControl: Pt = { x: 0, y: 0 };

  const s = d.trim();
  const len = s.length;
  let i = 0;

  const push = (points: Pt[], p: Pt) => {
    const last = points[points.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) return;
    points.push(p);
  };

  const ensure = () => {
    if (!current) current = { points: [{ x: cx, y: cy }] };
    return current;
  };

  const moveTo = (x: number, y: number) => {
    if (current && current.points.length > 0) subpaths.push(current);
    current = { points: [{ x, y }] };
    cx = x;
    cy = y;
    prevCurve = "none";
    lastControl = { x, y };
  };

  const lineTo = (x: number, y: number) => {
    push(ensure().points, { x, y });
    cx = x;
    cy = y;
    prevCurve = "none";
    lastControl = { x, y };
  };

  const cubicTo = (c1: Pt, c2: Pt, end: Pt) => {
    const sub = ensure();
    flattenCubic({ x: cx, y: cy }, c1, c2, end, sub.points);
    cx = end.x;
    cy = end.y;
    prevCurve = "C";
    lastControl = c2;
  };

  const quadTo = (control: Pt, end: Pt) => {
    const p0 = { x: cx, y: cy };
    cubicTo(
      { x: p0.x + (2 / 3) * (control.x - p0.x), y: p0.y + (2 / 3) * (control.y - p0.y) },
      { x: end.x + (2 / 3) * (control.x - end.x), y: end.y + (2 / 3) * (control.y - end.y) },
      end,
    );
    prevCurve = "Q";
    lastControl = control;
  };

  const closePath = () => {
    if (!current || current.points.length === 0) return;
    const first = current.points[0];
    push(current.points, first);
    subpaths.push(current);
    current = undefined;
    cx = first.x;
    cy = first.y;
    prevCurve = "none";
    lastControl = { x: cx, y: cy };
  };

  const reflect = (): Pt => ({ x: 2 * cx - lastControl.x, y: 2 * cy - lastControl.y });

  const execute = (cmd: string): string => {
    switch (cmd) {
      case "M":
      case "m": {
        const x = readNumber();
        const y = readNumber();
        moveTo(cmd === "m" ? cx + x : x, cmd === "m" ? cy + y : y);
        return cmd === "m" ? "l" : "L";
      }
      case "L":
      case "l": {
        const x = readNumber();
        const y = readNumber();
        lineTo(cmd === "l" ? cx + x : x, cmd === "l" ? cy + y : y);
        return cmd;
      }
      case "H":
      case "h": {
        const x = readNumber();
        lineTo(cmd === "h" ? cx + x : x, cy);
        return cmd;
      }
      case "V":
      case "v": {
        const y = readNumber();
        lineTo(cx, cmd === "v" ? cy + y : y);
        return cmd;
      }
      case "C":
      case "c": {
        const rel = cmd === "c";
        const c1 = abs(readNumber(), readNumber(), rel);
        const c2 = abs(readNumber(), readNumber(), rel);
        const end = abs(readNumber(), readNumber(), rel);
        cubicTo(c1, c2, end);
        return cmd;
      }
      case "S":
      case "s": {
        const rel = cmd === "s";
        const c1 = prevCurve === "C" ? reflect() : { x: cx, y: cy };
        const c2 = abs(readNumber(), readNumber(), rel);
        const end = abs(readNumber(), readNumber(), rel);
        cubicTo(c1, c2, end);
        return cmd;
      }
      case "Q":
      case "q": {
        const rel = cmd === "q";
        const control = abs(readNumber(), readNumber(), rel);
        const end = abs(readNumber(), readNumber(), rel);
        quadTo(control, end);
        return cmd;
      }
      case "T":
      case "t": {
        const rel = cmd === "t";
        const control = prevCurve === "Q" ? reflect() : { x: cx, y: cy };
        const end = abs(readNumber(), readNumber(), rel);
        quadTo(control, end);
        return cmd;
      }
      case "A":
      case "a": {
        const rx = Math.abs(readNumber());
        const ry = Math.abs(readNumber());
        const rotation = readNumber();
        const large = readFlag();
        const sweep = readFlag();
        const rel = cmd === "a";
        const end = abs(readNumber(), readNumber(), rel);
        arcTo(rx, ry, rotation, large, sweep, end);
        prevCurve = "none";
        lastControl = { x: cx, y: cy };
        return cmd;
      }
      default:
        throw new Error(`unsupported path command "${cmd}"`);
    }
  };

  const abs = (x: number, y: number, relative: boolean): Pt =>
    relative ? { x: cx + x, y: cy + y } : { x, y };

  const arcTo = (rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, end: Pt) => {
    const start = { x: cx, y: cy };
    if (Math.abs(start.x - end.x) < 1e-8 && Math.abs(start.y - end.y) < 1e-8) return;
    if (rx < 1e-8 || ry < 1e-8) {
      lineTo(end.x, end.y);
      return;
    }

    const phi = (rotation * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (start.x - end.x) / 2;
    const dy = (start.y - end.y) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;

    let rx2 = rx * rx;
    let ry2 = ry * ry;
    const x1p2 = x1p * x1p;
    const y1p2 = y1p * y1p;
    const lambda = x1p2 / rx2 + y1p2 / ry2;
    if (lambda > 1) {
      const scale = Math.sqrt(lambda);
      rx *= scale;
      ry *= scale;
      rx2 = rx * rx;
      ry2 = ry * ry;
    }

    const sign = large === sweep ? -1 : 1;
    const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
    const den = rx2 * y1p2 + ry2 * x1p2;
    const coef = den === 0 ? 0 : sign * Math.sqrt(num / den);
    const cxp = coef * ((rx * y1p) / ry);
    const cyp = coef * ((-ry * x1p) / rx);
    const center = {
      x: cos * cxp - sin * cyp + (start.x + end.x) / 2,
      y: sin * cxp + cos * cyp + (start.y + end.y) / 2,
    };

    const angle = (ux: number, uy: number, vx: number, vy: number) => {
      const dot = ux * vx + uy * vy;
      const mag = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      const clamped = mag === 0 ? 0 : Math.max(-1, Math.min(1, dot / mag));
      const unsigned = Math.acos(clamped);
      return ux * vy - uy * vx < 0 ? -unsigned : unsigned;
    };

    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    if (sweep && delta < 0) delta += Math.PI * 2;

    const pointAt = (theta: number): Pt => ({
      x: center.x + rx * Math.cos(theta) * cos - ry * Math.sin(theta) * sin,
      y: center.y + rx * Math.cos(theta) * sin + ry * Math.sin(theta) * cos,
    });
    const derivative = (theta: number): Pt => ({
      x: -rx * Math.sin(theta) * cos - ry * Math.cos(theta) * sin,
      y: -rx * Math.sin(theta) * sin + ry * Math.cos(theta) * cos,
    });

    const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
    const step = delta / steps;
    let theta = theta1;
    for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
      const next = theta + step;
      const k = (4 / 3) * Math.tan(step / 4);
      const p1 = pointAt(theta);
      const p2 = pointAt(next);
      const d1 = derivative(theta);
      const d2 = derivative(next);
      cubicTo(
        { x: p1.x + k * d1.x, y: p1.y + k * d1.y },
        { x: p2.x - k * d2.x, y: p2.y - k * d2.y },
        p2,
      );
      theta = next;
    }
  };

  const skipSep = () => {
    while (i < len && /[\s,]/.test(s[i])) i++;
  };

  const readNumber = (): number => {
    skipSep();
    if (i >= len) throw new Error("path ended while reading a number");
    const startIndex = i;
    if (s[i] === "+" || s[i] === "-") i++;
    let sawDigit = false;
    while (i < len && s[i] >= "0" && s[i] <= "9") {
      sawDigit = true;
      i++;
    }
    if (i < len && s[i] === ".") {
      i++;
      while (i < len && s[i] >= "0" && s[i] <= "9") {
        sawDigit = true;
        i++;
      }
    }
    if (i < len && (s[i] === "e" || s[i] === "E")) {
      const exp = i;
      i++;
      if (i < len && (s[i] === "+" || s[i] === "-")) i++;
      let expDigit = false;
      while (i < len && s[i] >= "0" && s[i] <= "9") {
        expDigit = true;
        i++;
      }
      if (!expDigit) i = exp;
    }
    if (!sawDigit) throw new Error(`expected a number at "${s.slice(startIndex, startIndex + 12)}"`);
    const value = Number(s.slice(startIndex, i));
    if (!Number.isFinite(value)) throw new Error(`invalid number "${s.slice(startIndex, i)}"`);
    return value;
  };

  const readFlag = (): boolean => {
    skipSep();
    const flag = s[i];
    if (flag !== "0" && flag !== "1") throw new Error("expected an arc flag of 0 or 1");
    i++;
    return flag === "1";
  };

  const isCommand = (ch: string) => /[MmLlHhVvCcSsQqTtAaZz]/.test(ch);

  i = 0;
  let cmd = "";
  while (i < len) {
    skipSep();
    if (i >= len) break;
    const ch = s[i];
    if (isCommand(ch)) {
      cmd = ch;
      i++;
      if (cmd === "Z" || cmd === "z") {
        closePath();
        cmd = "";
        continue;
      }
    } else if (!cmd) {
      throw new Error("path data must start with a command");
    }
    cmd = execute(cmd);
  }

  if (current && current.points.length > 0) subpaths.push(current);
  return subpaths;
}

function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[], depth = 0): void {
  if (
    depth > 12 ||
    (distanceToSegment(p1, p0, p3) <= FLATNESS && distanceToSegment(p2, p0, p3) <= FLATNESS)
  ) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p3.x) > 1e-6 || Math.abs(last.y - p3.y) > 1e-6) out.push(p3);
    return;
  }
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  flattenCubic(p0, p01, p012, p0123, out, depth + 1);
  flattenCubic(p0123, p123, p23, p3, out, depth + 1);
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polylineLength(points: Pt[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

function slicePolyline(points: Pt[], d0: number, d1: number): Pt[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cumulative[cumulative.length - 1];
  const from = Math.max(0, Math.min(total, d0));
  const to = Math.max(0, Math.min(total, d1));
  const out: Pt[] = [pointAlong(points, cumulative, from)];
  for (let i = 1; i < points.length; i++) {
    if (cumulative[i] > from + 1e-4 && cumulative[i] < to - 1e-4) out.push(points[i]);
  }
  const end = pointAlong(points, cumulative, to);
  const last = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.y - end.y) > 1e-4) out.push(end);
  return out;
}

function pointAlong(points: Pt[], cumulative: number[], distance: number): Pt {
  if (distance <= 0) return points[0];
  const total = cumulative[cumulative.length - 1];
  if (distance >= total) return points[points.length - 1];
  let i = 1;
  while (i < cumulative.length && cumulative[i] < distance) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span === 0 ? 0 : (distance - cumulative[i - 1]) / span;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
  };
}

function slicesToPath(slices: Pt[][]): string {
  let path = "";
  for (const points of slices) {
    if (points.length === 0) continue;
    path += `M${format(points[0].x)} ${format(points[0].y)}`;
    for (let i = 1; i < points.length; i++) {
      path += `L${format(points[i].x)} ${format(points[i].y)}`;
    }
  }
  return path;
}

function format(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}
