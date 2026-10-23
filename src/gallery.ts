import fs from "node:fs/promises";
import path from "node:path";
import { renderDocumentXml } from "./renderDocument";
import { VectorRender, isVectorDrawableXml } from "./renderVectorDrawable";

async function main(): Promise<void> {
  const root = path.join(__dirname, "..");
  const samplesDir = path.join(root, "samples");
  const files = await walk(samplesDir);
  const previews: Record<string, { day: Payload; night: Payload }> = {};

  for (const file of files) {
    const xml = await fs.readFile(file, "utf8");
    if (!isVectorDrawableXml(xml)) continue;
    const name = path.relative(samplesDir, file).split(path.sep).join("/");
    previews[name] = {
      day: payload(name, await renderDocumentXml(xml, file, { night: false })),
      night: payload(name, await renderDocumentXml(xml, file, { night: true })),
    };
  }

  const template = await fs.readFile(path.join(root, "media", "preview.html"), "utf8");
  const names = Object.keys(previews).sort((a, b) => a.localeCompare(b));
  const options = names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  const data = JSON.stringify(previews).replace(/</g, "\\u003c");
  const html = template
    .replaceAll("{{HEAD_EXTRA}}", "")
    .replaceAll("{{STYLE_URI}}", "../media/preview.css")
    .replaceAll(
      "{{HARNESS_BAR}}",
      `<div id="harness-bar"><label>Sample <select id="sample">${options}</select></label><span>Local preview harness</span></div>`,
    )
    .replaceAll("{{SCRIPT_EXTRA}}", `<script>\n${harnessScript(data)}\n</script>`)
    .replaceAll("{{NONCE}}", "harness")
    .replaceAll("{{SCRIPT_URI}}", "../media/preview.js");

  const output = path.join(root, "dist", "preview-harness.html");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html);
  console.log(output);
}

interface Payload {
  type: "update" | "error";
  fileName: string;
  svg?: string;
  warnings?: string[];
  widthDp?: number;
  heightDp?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  autoMirrored?: boolean;
  message?: string;
  night: boolean;
  follow: boolean;
  defaultBackground: string;
}

function payload(fileName: string, result: VectorRender): Payload {
  if (!result.ok) {
    return {
      type: "error",
      fileName,
      message: result.error,
      night: false,
      follow: true,
      defaultBackground: "checker",
    };
  }
  return {
    type: "update",
    fileName,
    svg: result.preview.svg,
    warnings: result.preview.warnings,
    widthDp: result.preview.widthDp,
    heightDp: result.preview.heightDp,
    viewportWidth: result.preview.viewportWidth,
    viewportHeight: result.preview.viewportHeight,
    autoMirrored: result.preview.autoMirrored,
    night: false,
    follow: true,
    defaultBackground: "checker",
  };
}

function harnessScript(data: string): string {
  return `
    const PREVIEWS = ${data};
    let night = false;
    let current = Object.keys(PREVIEWS).sort()[0];
    const sample = document.getElementById("sample");
    if (sample) {
      sample.value = current;
      sample.addEventListener("change", () => {
        current = sample.value;
        deliver();
      });
    }
    function deliver() {
      const entry = PREVIEWS[current];
      const preview = night ? entry.night : entry.day;
      window.postMessage(Object.assign({}, preview, { night: night, follow: true }), "*");
    }
    window.acquireVsCodeApi = function () {
      return {
        postMessage(message) {
          if (message.type === "ready") deliver();
          if (message.type === "setNight") {
            night = !!message.night;
            deliver();
          }
          if (message.type === "copySvg" && navigator.clipboard) {
            navigator.clipboard.writeText(message.svg).catch(() => {});
          }
          if (message.type === "exportSvg") {
            const blob = new Blob([message.svg], { type: "image/svg+xml" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = current.replace(/\\.xml$/, "") + ".svg";
            link.click();
          }
        },
        getState() { return null; },
        setState() {},
      };
    };
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith(".xml")) files.push(full);
  }
  return files.sort();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
