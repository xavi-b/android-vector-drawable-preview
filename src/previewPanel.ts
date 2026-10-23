import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { renderDocumentXml } from "./renderDocument";
import { VectorPreview, VectorRender } from "./renderVectorDrawable";

interface UpdateMessage {
  type: "update";
  fileName: string;
  svg: string;
  warnings: string[];
  widthDp: number;
  heightDp: number;
  viewportWidth: number;
  viewportHeight: number;
  autoMirrored: boolean;
  night: boolean;
  follow: boolean;
  defaultBackground: string;
}

export class VectorPreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private document: vscode.TextDocument | undefined;
  private night: boolean;
  private follow = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private renderGeneration = 0;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.night = vscode.workspace.getConfiguration("androidVectorPreview").get<string>("theme") === "dark";
  }

  async open(uri?: vscode.Uri): Promise<void> {
    const document = await this.resolveDocument(uri);
    if (!document) return;
    this.document = document;
    this.ensurePanel();
    this.panel?.reveal(vscode.ViewColumn.Beside, false);
    this.schedule();
  }

  async export(uri?: vscode.Uri): Promise<void> {
    if (this.panel && !uri) {
      this.panel.webview.postMessage({ type: "requestExport" });
      return;
    }
    const document = uri ? await vscode.workspace.openTextDocument(uri) : this.document;
    if (!document) {
      void vscode.window.showInformationMessage("Open a VectorDrawable XML file to export.");
      return;
    }
    const rendered = await renderDocumentXml(document.getText(), documentPath(document), { night: this.night });
    if (!rendered.ok) {
      void vscode.window.showErrorMessage(rendered.error);
      return;
    }
    await this.saveSvg(rendered.preview.svg, document);
  }

  onDocumentChanged(document: vscode.TextDocument): void {
    if (!this.panel || !this.document) return;
    const current = this.document.uri.toString();
    if (document.uri.toString() === current || isRelevantResource(document.uri)) this.schedule();
  }

  onDocumentClosed(document: vscode.TextDocument): void {
    if (!this.document || document.uri.toString() !== this.document.uri.toString()) return;
    this.document = undefined;
    this.post({
      type: "error",
      fileName: path.basename(document.uri.fsPath || "Vector drawable"),
      message: "The document was closed.",
      night: this.night,
      follow: this.follow,
      defaultBackground: defaultBackground(),
    });
  }

  followActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!this.follow || !this.panel || !editor) return;
    if (editor.document.languageId !== "xml") return;
    if (this.document && editor.document.uri.toString() === this.document.uri.toString()) return;
    if (!looksLikeVector(editor.document.getText())) return;
    this.document = editor.document;
    this.schedule();
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async resolveDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uri) {
      const document = await vscode.workspace.openTextDocument(uri);
      const visible = vscode.window.visibleTextEditors.some(
        (editor) => editor.document.uri.toString() === document.uri.toString(),
      );
      if (!visible) {
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
      }
      if (!looksLikeVector(document.getText())) {
        void vscode.window.showErrorMessage("This file does not contain an Android VectorDrawable.");
        return undefined;
      }
      return document;
    }

    const active = vscode.window.activeTextEditor?.document;
    if (!active) {
      void vscode.window.showInformationMessage("Open an Android VectorDrawable XML file to preview it.");
      return undefined;
    }
    if (!looksLikeVector(active.getText())) {
      void vscode.window.showErrorMessage("This file does not contain an Android VectorDrawable.");
      return undefined;
    }
    return active;
  }

  private ensurePanel(): void {
    if (this.panel) return;
    const panel = vscode.window.createWebviewPanel(
      "androidVectorPreview",
      "Vector Drawable",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );
    panel.webview.html = previewHtml(panel.webview, this.context.extensionUri);
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.renderGeneration++;
      for (const disposable of this.disposables) disposable.dispose();
      this.disposables = [];
    });
    panel.webview.onDidReceiveMessage((message: IncomingMessage) => {
      void this.onMessage(message);
    });
    this.panel = panel;
  }

  private async onMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.schedule();
        break;
      case "setNight":
        this.night = message.night;
        this.schedule();
        break;
      case "setFollow":
        this.follow = message.follow;
        if (this.follow) this.followActiveEditor(vscode.window.activeTextEditor);
        break;
      case "copySvg":
        await vscode.env.clipboard.writeText(message.svg);
        void vscode.window.setStatusBarMessage("Copied SVG", 2000);
        break;
      case "exportSvg":
        if (!message.svg) {
          void vscode.window.showInformationMessage("Nothing to export yet.");
          return;
        }
        await this.saveSvg(message.svg, this.document);
        break;
      default:
        break;
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.renderCurrent();
    }, 120);
  }

  private async renderCurrent(): Promise<void> {
    const panel = this.panel;
    const document = this.document;
    if (!panel || !document) return;
    const generation = ++this.renderGeneration;
    const fileName = path.basename(document.uri.fsPath || document.uri.path || "Vector drawable");
    let rendered: VectorRender;
    try {
      rendered = await renderDocumentXml(document.getText(), documentPath(document), { night: this.night });
    } catch (error) {
      rendered = { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
    if (generation !== this.renderGeneration || !this.panel) return;

    panel.title = `Preview ${fileName}`;
    if (!rendered.ok) {
      this.post({
        type: "error",
        fileName,
        message: rendered.error,
        night: this.night,
        follow: this.follow,
        defaultBackground: defaultBackground(),
      });
      return;
    }
    this.post(updateMessage(fileName, rendered.preview, this.night, this.follow));
  }

  private post(message: UpdateMessage | ErrorMessage): void {
    this.panel?.webview.postMessage(message);
  }

  private async saveSvg(svg: string, document: vscode.TextDocument | undefined): Promise<void> {
    const baseName = document ? path.basename(document.uri.fsPath || "vector", ".xml") : "vector";
    const directory = document?.uri.fsPath ? path.dirname(document.uri.fsPath) : undefined;
    const target = await vscode.window.showSaveDialog({
      defaultUri: directory ? vscode.Uri.file(path.join(directory, `${baseName}.svg`)) : undefined,
      filters: { SVG: ["svg"] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(svg, "utf8"));
    void vscode.window.setStatusBarMessage(`Saved ${path.basename(target.fsPath)}`, 2000);
  }
}

interface ErrorMessage {
  type: "error";
  fileName: string;
  message: string;
  night: boolean;
  follow: boolean;
  defaultBackground: string;
}

type IncomingMessage =
  | { type: "ready" }
  | { type: "setNight"; night: boolean }
  | { type: "setFollow"; follow: boolean }
  | { type: "copySvg"; svg: string }
  | { type: "exportSvg"; svg: string };

function updateMessage(fileName: string, preview: VectorPreview, night: boolean, follow: boolean): UpdateMessage {
  return {
    type: "update",
    fileName,
    svg: preview.svg,
    warnings: preview.warnings,
    widthDp: preview.widthDp,
    heightDp: preview.heightDp,
    viewportWidth: preview.viewportWidth,
    viewportHeight: preview.viewportHeight,
    autoMirrored: preview.autoMirrored,
    night,
    follow,
    defaultBackground: defaultBackground(),
  };
}

function previewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = cryptoNonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "preview.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "preview.js"));
  const template = fs.readFileSync(path.join(extensionUri.fsPath, "media", "preview.html"), "utf8");
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return template
    .replaceAll("{{HEAD_EXTRA}}", `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replaceAll("{{STYLE_URI}}", String(styleUri))
    .replaceAll("{{HARNESS_BAR}}", "")
    .replaceAll("{{SCRIPT_EXTRA}}", "")
    .replaceAll("{{NONCE}}", nonce)
    .replaceAll("{{SCRIPT_URI}}", String(scriptUri));
}

function cryptoNonce(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Buffer.from(bytes).toString("hex");
}

function defaultBackground(): string {
  const value = vscode.workspace.getConfiguration("androidVectorPreview").get<string>("background");
  if (value === "light" || value === "dark") return value;
  return "checker";
}

function documentPath(document: vscode.TextDocument): string | undefined {
  if (document.uri.scheme === "untitled" || !document.uri.fsPath) return undefined;
  return document.uri.fsPath;
}

function looksLikeVector(xml: string): boolean {
  return /<(?:[\w.-]+:)?vector\b/.test(xml) || /<(?:[\w.-]+:)?animated-vector\b/.test(xml);
}

function isRelevantResource(uri: vscode.Uri): boolean {
  const normalized = uri.fsPath.replace(/\\/g, "/");
  return (
    /\/res\/(values|color|drawable)(-[^/]+)?\/[^/]+\.xml$/.test(normalized) ||
    normalized.endsWith("/AndroidManifest.xml")
  );
}
