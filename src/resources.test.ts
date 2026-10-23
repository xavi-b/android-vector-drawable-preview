import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderDocumentXml } from "./renderDocument";
import {
  findDrawableFile,
  findResDir,
  loadProjectResources,
  parseColorStateList,
  parseDimensionDp,
  resolveDimensionDp,
  resolveTheme,
} from "./resources";

const demoLogo = path.join(
  __dirname,
  "..",
  "samples",
  "demo-app",
  "src",
  "main",
  "res",
  "drawable",
  "ic_logo.xml",
);
const demoAvd = path.join(
  __dirname,
  "..",
  "samples",
  "demo-app",
  "src",
  "main",
  "res",
  "drawable",
  "avd_themed.xml",
);

test("parses dimensions and color state lists", () => {
  assert.equal(parseDimensionDp("48dp"), 48);
  assert.equal(parseDimensionDp("1in"), 160);
  const resolved = resolveDimensionDp("@dimen/icon_size", new Map([["icon_size", "24dp"]]), () => {});
  assert.equal(resolved, 24);

  const color = parseColorStateList(`
    <selector xmlns:android="http://schemas.android.com/apk/res/android">
      <item android:color="#FF010101"/>
      <item android:state_pressed="true" android:color="#FFEEEEEE"/>
    </selector>`);
  assert.equal(color?.toLowerCase(), "#ff010101");
});

test("child theme items override parents, including implicit parents", () => {
  const styles = new Map([
    ["Theme.Demo", { parent: undefined, items: new Map([["colorPrimary", "#FF000000"]]) }],
    [
      "Theme.Demo.NoActionBar",
      { parent: undefined, items: new Map([["colorControlNormal", "@color/icon_tint"]]) },
    ],
  ]);
  const attrs = resolveTheme(styles, "Theme.Demo.NoActionBar");
  assert.equal(attrs.get("colorPrimary"), "#FF000000");
  assert.equal(attrs.get("colorControlNormal"), "@color/icon_tint");
});

test("loads the demo app's day and night resources", async () => {
  const resDir = await findResDir(demoLogo);
  assert.ok(resDir?.endsWith(`${path.sep}res`));

  const day = await loadProjectResources(demoLogo, false);
  assert.equal(day.colors.get("brand")?.toLowerCase(), "#ff6c4df6");
  assert.equal(day.colors.get("icon_tint")?.toLowerCase(), "#ff1a1a1a");
  assert.equal(day.colors.get("badge")?.toLowerCase(), "#ffff6d00");
  assert.equal(day.dimens.get("icon_size"), "48dp");
  assert.equal(day.themeAttrs.get("colorControlNormal"), "@color/icon_tint");

  const night = await loadProjectResources(demoLogo, true);
  assert.equal(night.colors.get("brand")?.toLowerCase(), "#ffd0bcff");
  assert.equal(night.colors.get("icon_tint")?.toLowerCase(), "#fff2f2f2");
  assert.equal(night.colors.get("badge")?.toLowerCase(), "#ffff6d00");
});

test("prefers anydpi and night drawables", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "avd-res-"));
  const res = path.join(root, "res");
  await fs.mkdir(path.join(res, "drawable"), { recursive: true });
  await fs.mkdir(path.join(res, "drawable-anydpi"), { recursive: true });
  await fs.mkdir(path.join(res, "drawable-night"), { recursive: true });
  await fs.mkdir(path.join(res, "drawable-hdpi"), { recursive: true });
  await fs.writeFile(path.join(res, "drawable", "ic.xml"), "<vector/>");
  await fs.writeFile(path.join(res, "drawable-anydpi", "ic.xml"), "<vector/>");
  await fs.writeFile(path.join(res, "drawable-night", "ic.xml"), "<vector/>");
  await fs.writeFile(path.join(res, "drawable-hdpi", "ic.xml"), "<vector/>");

  const day = await findDrawableFile(res, "ic", false);
  const night = await findDrawableFile(res, "ic", true);
  assert.equal(day, path.join(res, "drawable-anydpi", "ic.xml"));
  assert.equal(night, path.join(res, "drawable-night", "ic.xml"));
});

test("renders the demo logo and themed animated vector", async () => {
  const logoXml = await fs.readFile(demoLogo, "utf8");
  const day = await renderDocumentXml(logoXml, demoLogo, { night: false });
  assert.equal(day.ok, true);
  if (!day.ok) return;
  assert.equal(day.preview.widthDp, 48);
  assert.match(day.preview.svg, /fill="rgb\(108,77,246\)"/);
  assert.match(day.preview.svg, /fill="rgb\(255,109,0\)"/);

  const night = await renderDocumentXml(logoXml, demoLogo, { night: true });
  assert.equal(night.ok, true);
  if (!night.ok) return;
  assert.match(night.preview.svg, /fill="rgb\(208,188,255\)"/);

  const avdXml = await fs.readFile(demoAvd, "utf8");
  const themed = await renderDocumentXml(avdXml, demoAvd, { night: false });
  assert.equal(themed.ok, true);
  if (!themed.ok) return;
  assert.match(themed.preview.svg, /flood-color="rgb\(26,26,26\)"/);
  assert.match(themed.preview.svg, /fill="rgb\(255,255,255\)"/);
  assert.ok(themed.preview.warnings.some((warning) => warning.includes("@drawable/ic_themed")));

  const themedNight = await renderDocumentXml(avdXml, demoAvd, { night: true });
  assert.equal(themedNight.ok, true);
  if (!themedNight.ok) return;
  assert.match(themedNight.preview.svg, /flood-color="rgb\(242,242,242\)"/);
});
