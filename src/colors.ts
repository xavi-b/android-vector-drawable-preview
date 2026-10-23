export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
export const UNRESOLVED_COLOR: Rgba = { r: 255, g: 0, b: 255, a: 1 };

/**
 * Resolved values of the framework colors people reference as `@android:color/*`.
 * Hex values match the colors the framework CTS resolves for `android.R.color`.
 */
export const ANDROID_COLORS: Readonly<Record<string, string>> = {
  background_dark: "#ff000000",
  background_light: "#ffffffff",
  black: "#ff000000",
  darker_gray: "#ffaaaaaa",
  holo_blue_bright: "#ff00ddff",
  holo_blue_dark: "#ff0099cc",
  holo_blue_light: "#ff33b5e5",
  holo_green_dark: "#ff669900",
  holo_green_light: "#ff99cc00",
  holo_orange_dark: "#ffff8800",
  holo_orange_light: "#ffffbb33",
  holo_purple: "#ffaa66cc",
  holo_red_dark: "#ffcc0000",
  holo_red_light: "#ffff4444",
  primary_text_dark: "#ffffffff",
  primary_text_dark_nodisable: "#ffffffff",
  primary_text_light: "#ff000000",
  primary_text_light_nodisable: "#ff000000",
  secondary_text_dark: "#ffbebebe",
  secondary_text_dark_nodisable: "#ffbebebe",
  secondary_text_light: "#ff323232",
  secondary_text_light_nodisable: "#ffbebebe",
  tab_indicator_text: "#ff808080",
  tertiary_text_dark: "#ff808080",
  tertiary_text_light: "#ff808080",
  transparent: "#00000000",
  white: "#ffffffff",
  widget_edittext_dark: "#ff000000",
};

/** Material 3 baseline palette, used only when the app theme does not set the attribute. */
const LIGHT_THEME: Readonly<Record<string, string>> = {
  colorPrimary: "#FF6750A4",
  colorOnPrimary: "#FFFFFFFF",
  colorPrimaryContainer: "#FFEADDFF",
  colorOnPrimaryContainer: "#FF21005D",
  colorPrimaryDark: "#FF4F378B",
  colorSecondary: "#FF625B71",
  colorOnSecondary: "#FFFFFFFF",
  colorSecondaryContainer: "#FFE8DEF8",
  colorOnSecondaryContainer: "#FF1D192B",
  colorTertiary: "#FF7D5260",
  colorOnTertiary: "#FFFFFFFF",
  colorError: "#FFB3261E",
  colorOnError: "#FFFFFFFF",
  colorErrorContainer: "#FFF9DEDC",
  colorOnErrorContainer: "#FF410E0B",
  colorSurface: "#FFFFFBFE",
  colorOnSurface: "#FF1C1B1F",
  colorSurfaceVariant: "#FFE7E0EC",
  colorOnSurfaceVariant: "#FF49454F",
  colorOutline: "#FF79747E",
  colorOutlineVariant: "#FFCAC4D0",
  colorBackground: "#FFFFFBFE",
  colorOnBackground: "#FF1C1B1F",
  colorControlNormal: "#FF49454F",
  colorControlActivated: "#FF6750A4",
  colorControlHighlight: "#1F1C1B1F",
  colorAccent: "#FF6750A4",
  colorForeground: "#FF1C1B1F",
  textColorPrimary: "#FF1C1B1F",
  textColorSecondary: "#FF49454F",
  textColorHint: "#FF79747E",
  statusBarColor: "#FFFFFBFE",
  navigationBarColor: "#FFFFFBFE",
  windowBackground: "#FFFFFBFE",
};

const DARK_THEME: Readonly<Record<string, string>> = {
  colorPrimary: "#FFD0BCFF",
  colorOnPrimary: "#FF381E72",
  colorPrimaryContainer: "#FF4F378B",
  colorOnPrimaryContainer: "#FFEADDFF",
  colorPrimaryDark: "#FFD0BCFF",
  colorSecondary: "#FFCCC2DC",
  colorOnSecondary: "#FF332D41",
  colorSecondaryContainer: "#FF4A4458",
  colorOnSecondaryContainer: "#FFE8DEF8",
  colorTertiary: "#FFEFB8C8",
  colorOnTertiary: "#FF492532",
  colorError: "#FFF2B8B5",
  colorOnError: "#FF601410",
  colorErrorContainer: "#FF8C1D18",
  colorOnErrorContainer: "#FFF9DEDC",
  colorSurface: "#FF1C1B1F",
  colorOnSurface: "#FFE6E1E5",
  colorSurfaceVariant: "#FF49454F",
  colorOnSurfaceVariant: "#FFCAC4D0",
  colorOutline: "#FF938F99",
  colorOutlineVariant: "#FF49454F",
  colorBackground: "#FF1C1B1F",
  colorOnBackground: "#FFE6E1E5",
  colorControlNormal: "#FFCAC4D0",
  colorControlActivated: "#FFD0BCFF",
  colorControlHighlight: "#33E6E1E5",
  colorAccent: "#FFD0BCFF",
  colorForeground: "#FFE6E1E5",
  textColorPrimary: "#FFE6E1E5",
  textColorSecondary: "#FFCAC4D0",
  textColorHint: "#FF938F99",
  statusBarColor: "#FF1C1B1F",
  navigationBarColor: "#FF1C1B1F",
  windowBackground: "#FF1C1B1F",
};

export function materialThemeColor(name: string, dark: boolean): string | undefined {
  const key = name.replace(/^android:/, "");
  return (dark ? DARK_THEME : LIGHT_THEME)[key];
}

export function parseHexColor(input: string): Rgba | undefined {
  let hex = input.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;

  const byte = (chars: string) => parseInt(chars, 16);
  const expand = (char: string) => byte(char + char);

  if (hex.length === 3) {
    return { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]), a: 1 };
  }
  if (hex.length === 4) {
    return {
      a: expand(hex[0]) / 255,
      r: expand(hex[1]),
      g: expand(hex[2]),
      b: expand(hex[3]),
    };
  }
  if (hex.length === 6) {
    return { r: byte(hex.slice(0, 2)), g: byte(hex.slice(2, 4)), b: byte(hex.slice(4, 6)), a: 1 };
  }
  if (hex.length === 8) {
    return {
      a: byte(hex.slice(0, 2)) / 255,
      r: byte(hex.slice(2, 4)),
      g: byte(hex.slice(4, 6)),
      b: byte(hex.slice(6, 8)),
    };
  }
  return undefined;
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { r: color.r, g: color.g, b: color.b, a: clamp01(color.a * alpha) };
}

export function toCss(color: Rgba): string {
  const a = Math.round(color.a * 1000) / 1000;
  if (a >= 0.999) return `rgb(${color.r},${color.g},${color.b})`;
  if (a <= 0) return `rgba(${color.r},${color.g},${color.b},0)`;
  return `rgba(${color.r},${color.g},${color.b},${a})`;
}

export function toCssRgb(color: Rgba): string {
  return `rgb(${color.r},${color.g},${color.b})`;
}

export interface ColorContext {
  projectColors: ReadonlyMap<string, string>;
  themeAttrs: ReadonlyMap<string, string>;
  darkTheme: boolean;
  warn: (message: string) => void;
}

export function resolveColorValue(raw: string, ctx: ColorContext, label: string, stack: string[] = []): Rgba {
  const value = raw.trim();
  if (!value || value === "@null" || value === "@empty" || value === "null") return TRANSPARENT;

  const hex = parseHexColor(value);
  if (hex) return hex;

  const android = /^@\*?android:color\/([A-Za-z0-9_.]+)$/.exec(value);
  if (android) {
    const named = ANDROID_COLORS[android[1]];
    if (!named) {
      ctx.warn(`Unresolved @android:color/${android[1]} for ${label}. Using magenta.`);
      return UNRESOLVED_COLOR;
    }
    return parseHexColor(named) ?? UNRESOLVED_COLOR;
  }

  const project = /^@(?:[A-Za-z0-9_.]+:)?\*?color\/([A-Za-z0-9_.]+)$/.exec(value);
  if (project) {
    const name = project[1];
    const key = `@color/${name}`;
    if (stack.includes(key)) {
      ctx.warn(`Color reference cycle at ${key} for ${label}. Using magenta.`);
      return UNRESOLVED_COLOR;
    }
    const next = ctx.projectColors.get(name);
    if (next === undefined) {
      ctx.warn(`Unresolved @color/${name} for ${label}. Using magenta.`);
      return UNRESOLVED_COLOR;
    }
    return resolveColorValue(next, ctx, label, [...stack, key]);
  }

  const attr = /^\?(?:(?:android:)?attr\/|android:)?([A-Za-z0-9_.]+)$/.exec(value);
  if (attr) {
    const name = attr[1];
    const key = `?attr/${name}`;
    if (stack.includes(key)) {
      ctx.warn(`Theme attribute cycle at ${key} for ${label}. Using magenta.`);
      return UNRESOLVED_COLOR;
    }
    const fromTheme = ctx.themeAttrs.get(name) ?? ctx.themeAttrs.get(name.replace(/^android:/, ""));
    if (fromTheme !== undefined) {
      return resolveColorValue(fromTheme, ctx, label, [...stack, key]);
    }
    const fallback = materialThemeColor(name, ctx.darkTheme);
    if (fallback) {
      const mode = ctx.darkTheme ? "dark" : "light";
      ctx.warn(
        `Theme attribute ?attr/${name} is not set by the app theme. Using a Material 3 ${mode} fallback for ${label}.`,
      );
      return resolveColorValue(fallback, ctx, label, [...stack, key]);
    }
    ctx.warn(`Unresolved theme attribute ?attr/${name} for ${label}. Using magenta.`);
    return UNRESOLVED_COLOR;
  }

  ctx.warn(`Unrecognized color "${value}" for ${label}. Using magenta.`);
  return UNRESOLVED_COLOR;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}
