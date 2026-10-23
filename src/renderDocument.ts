import fs from "node:fs/promises";
import path from "node:path";
import { VectorRender, externalDrawableReference, renderVectorDrawable } from "./renderVectorDrawable";
import { findDrawableFile, findResDir, loadProjectResources } from "./resources";

export interface DocumentRenderOptions {
  night: boolean;
}

export async function renderDocumentXml(
  xml: string,
  fsPath: string | undefined,
  options: DocumentRenderOptions,
): Promise<VectorRender> {
  const warnings: string[] = [];
  let currentXml = xml;
  let currentPath = fsPath;
  const seen = new Set<string>();

  for (let hop = 0; hop < 4; hop++) {
    const reference = externalDrawableReference(currentXml);
    if (!reference) break;
    if (!currentPath) {
      warnings.push(`Could not resolve @drawable/${reference} because the file is not saved.`);
      break;
    }
    const resDir = await findResDir(currentPath);
    const file = resDir ? await findDrawableFile(resDir, reference, options.night) : undefined;
    if (!file) {
      warnings.push(`Could not find @drawable/${reference}.`);
      break;
    }
    const resolved = path.resolve(file);
    if (seen.has(resolved)) {
      warnings.push(`Drawable reference cycle at @drawable/${reference}.`);
      break;
    }
    seen.add(resolved);
    try {
      currentXml = await fs.readFile(resolved, "utf8");
    } catch {
      warnings.push(`Could not read @drawable/${reference}.`);
      break;
    }
    currentPath = resolved;
    warnings.push(`Showing @drawable/${reference}. Animation is not played.`);
  }

  const resources = currentPath
    ? await loadProjectResources(currentPath, options.night)
    : { colors: new Map<string, string>(), dimens: new Map<string, string>(), themeAttrs: new Map<string, string>(), warnings: [] as string[] };

  const rendered = renderVectorDrawable(currentXml, {
    projectColors: resources.colors,
    projectDimens: resources.dimens,
    themeAttrs: resources.themeAttrs,
    darkTheme: options.night,
    fileName: currentPath ? path.basename(currentPath) : undefined,
  });

  const extra = [...warnings, ...resources.warnings];
  if (!rendered.ok) {
    return { ok: false, error: extra.length ? `${rendered.error}\n${extra.join("\n")}` : rendered.error };
  }
  return {
    ok: true,
    preview: {
      ...rendered.preview,
      warnings: [...extra, ...rendered.preview.warnings],
    },
  };
}
