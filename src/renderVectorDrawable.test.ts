import assert from "node:assert/strict";
import { test } from "node:test";
import { RenderOptions, VectorPreview, renderVectorDrawable } from "./renderVectorDrawable";

function vector(inner: string, extra = "", size = `android:width="24dp" android:height="24dp"`): string {
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" ${size} android:viewportWidth="24" android:viewportHeight="24" ${extra}>${inner}</vector>`;
}

function preview(xml: string, options?: RenderOptions): VectorPreview {
  const result = renderVectorDrawable(xml, options);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (!result.ok) throw new Error("unreachable");
  return result.preview;
}

test("rejects files that are not vectors", () => {
  const text = renderVectorDrawable("hello");
  assert.equal(text.ok, false);
  const shape = renderVectorDrawable(`<shape xmlns:android="http://schemas.android.com/apk/res/android"></shape>`);
  assert.equal(shape.ok, false);
  if (!shape.ok) assert.match(shape.error, /<shape>/);
  const missing = renderVectorDrawable(
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp"></vector>`,
  );
  assert.equal(missing.ok, false);
});

test("expands Android color formats and leaves the default fill empty", () => {
  const solid = preview(
    vector(`<path android:fillColor="#80FF0000" android:pathData="M0,0h10v10h-10z"/>`),
  );
  assert.match(solid.svg, /fill="rgba\(255,0,0,0\.502\)"/);

  const stroked = preview(
    vector(
      `<path android:pathData="M1,1h4" android:strokeColor="#0F0" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="bevel" android:strokeMiterLimit="8"/>`,
    ),
  );
  assert.match(stroked.svg, /fill="none"/);
  assert.match(stroked.svg, /stroke="rgb\(0,255,0\)"/);
  assert.match(stroked.svg, /stroke-width="2"/);
  assert.match(stroked.svg, /stroke-linecap="round"/);
  assert.match(stroked.svg, /stroke-linejoin="bevel"/);
  assert.match(stroked.svg, /stroke-miterlimit="8"/);
});

test("uses even-odd fill and a hairline for a zero stroke width", () => {
  const ring = preview(
    vector(
      `<path android:fillColor="#FFFF6D00" android:fillType="evenOdd" android:pathData="M0,0h10v10h-10z M2,2h6v6h-6z"/><path android:pathData="M0,0h1" android:strokeColor="#FF000000" android:strokeWidth="0"/>`,
    ),
  );
  assert.match(ring.svg, /fill-rule="evenodd"/);
  assert.match(ring.svg, /vector-effect="non-scaling-stroke"/);
  assert.ok(ring.warnings.some((warning) => warning.includes("hairline")));
});

test("applies group transforms in Android's order and does not clip earlier siblings", () => {
  const grouped = preview(
    vector(
      `<group android:pivotX="12" android:pivotY="12" android:rotation="45"><path android:fillColor="#FF1565C0" android:pathData="M7,7h10v10h-10z"/></group>`,
    ),
  );
  assert.match(grouped.svg, /transform="translate\(12, 12\) rotate\(45\) translate\(-12, -12\)"/);

  const moved = preview(
    vector(`<group android:translateX="3" android:translateY="4" android:pivotX="9"><path android:fillColor="#FF000000" android:pathData="M0,0h1v1h-1z"/></group>`),
  );
  assert.match(moved.svg, /transform="translate\(3, 4\)"/);
  assert.doesNotMatch(moved.svg, /rotate|scale/);

  const clipped = preview(
    vector(
      `<group><path android:fillColor="#FF0000" android:pathData="M0,0h1v1h-1z"/><clip-path android:pathData="M0,0h2v2h-2z"/><path android:fillColor="#00FF00" android:pathData="M0,0h3v3h-3z"/></group>`,
    ),
  );
  const red = clipped.svg.indexOf('fill="rgb(255,0,0)"');
  const clip = clipped.svg.indexOf('clip-path="url(#clip');
  const green = clipped.svg.indexOf('fill="rgb(0,255,0)"');
  assert.ok(red !== -1 && clip !== -1 && green !== -1);
  assert.ok(red < clip && clip < green);
});

test("builds user-space gradients and a sweep conic gradient", () => {
  const linear = preview(
    vector(
      `<path android:pathData="M0,0h24v24h-24z"><aapt:attr name="android:fillColor"><gradient android:startX="0" android:startY="12" android:endX="24" android:endY="12" android:startColor="#FFFF0000" android:endColor="#FF0000FF" android:tileMode="mirror"/></aapt:attr></path>`,
    ),
  );
  assert.match(linear.svg, /<linearGradient[^>]*gradientUnits="userSpaceOnUse"/);
  assert.match(linear.svg, /spreadMethod="reflect"/);
  assert.match(linear.svg, /stop-color="rgb\(255,0,0\)"/);
  assert.match(linear.svg, /stop-color="rgb\(0,0,255\)"/);

  const radial = preview(
    vector(
      `<path android:pathData="M0,0h10v10h-10z"><aapt:attr name="android:fillColor"><gradient android:type="radial" android:centerX="5" android:centerY="5" android:gradientRadius="4" android:startColor="#FFFFFFFF" android:endColor="#FF000000"/></aapt:attr></path>`,
    ),
  );
  assert.match(radial.svg, /<radialGradient[^>]*r="4"/);

  const sweep = preview(
    vector(
      `<path android:pathData="M0,0h10v10h-10z"><aapt:attr name="android:fillColor"><gradient android:type="sweep" android:centerX="5" android:centerY="5"><item android:offset="0" android:color="#FFFF0000"/><item android:offset="1" android:color="#FF0000FF"/></gradient></aapt:attr></path>`,
    ),
  );
  assert.match(sweep.svg, /conic-gradient\(from 90deg at/);
  assert.match(sweep.svg, /<mask /);
});

test("tints with src_in and resolves project colors, theme attrs, and dimens", () => {
  const tinted = preview(
    vector(
      `<path android:fillColor="@android:color/white" android:pathData="M0,0h10v10h-10z"/>`,
      `android:tint="#FF0080FF"`,
    ),
  );
  assert.match(tinted.svg, /fill="rgb\(255,255,255\)"/);
  assert.match(tinted.svg, /flood-color="rgb\(0,128,255\)"/);
  assert.match(tinted.svg, /operator="in"/);

  const branded = preview(
    vector(
      `<path android:fillColor="@color/brand" android:pathData="M0,0h1v1h-1z"/>`,
      "",
      `android:width="@dimen/icon_size" android:height="@dimen/icon_size"`,
    ),
    {
      projectColors: new Map([["brand", "#FF6C4DF6"]]),
      projectDimens: new Map([["icon_size", "48dp"]]),
    },
  );
  assert.match(branded.svg, /fill="rgb\(108,77,246\)"/);
  assert.match(branded.svg, /width="48"/);
  assert.equal(branded.widthDp, 48);

  const themed = preview(vector(`<path android:fillColor="?attr/colorControlNormal" android:pathData="M0,0h1v1h-1z"/>`));
  assert.match(themed.svg, /fill="rgb\(73,69,79\)"/);
  assert.ok(themed.warnings.some((warning) => warning.includes("Material 3 light fallback")));

  const overridden = preview(
    vector(`<path android:fillColor="?attr/colorControlNormal" android:pathData="M0,0h1v1h-1z"/>`),
    { themeAttrs: new Map([["colorControlNormal", "#FF112233"]]) },
  );
  assert.match(overridden.svg, /fill="rgb\(17,34,51\)"/);
  assert.equal(
    overridden.warnings.some((warning) => warning.includes("fallback")),
    false,
  );
});

test("reports cycles, trims curves, and keeps directional icons unmirrored until requested", () => {
  const cycle = preview(vector(`<path android:fillColor="@color/a" android:pathData="M0,0h1v1h-1z"/>`), {
    projectColors: new Map([
      ["a", "@color/b"],
      ["b", "@color/a"],
    ]),
  });
  assert.match(cycle.svg, /fill="rgb\(255,0,255\)"/);
  assert.ok(cycle.warnings.some((warning) => warning.includes("cycle")));

  const trimmed = preview(
    vector(
      `<path android:fillColor="#FF000000" android:pathData="M0,0 C10,0 10,0 10,0" android:trimPathStart="0" android:trimPathEnd="0.5"/>`,
    ),
  );
  assert.doesNotMatch(trimmed.svg, / C/);
  assert.match(trimmed.svg, /L/);
  assert.ok(trimmed.warnings.some((warning) => warning.includes("flattened")));

  const arrow = preview(
    vector(`<path android:fillColor="#FF000000" android:pathData="M0,0h1v1h-1z"/>`, `android:autoMirrored="true" android:alpha="0.5"`),
  );
  assert.equal(arrow.autoMirrored, true);
  assert.doesNotMatch(arrow.svg, /scale\(-1/);
  assert.match(arrow.svg, /opacity="0.5"/);
});

test("renders an inline animated vector as its static drawable", () => {
  const animated = preview(
    `<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"><aapt:attr xmlns:aapt="http://schemas.android.com/aapt" name="android:drawable"><vector android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FF00FF00" android:pathData="M0,0h2v2h-2z"/></vector></aapt:attr></animated-vector>`,
  );
  assert.match(animated.svg, /fill="rgb\(0,255,0\)"/);
  assert.ok(animated.warnings.some((warning) => warning.includes("static")));
});
