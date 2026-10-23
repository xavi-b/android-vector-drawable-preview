import * as vscode from "vscode";
import { VectorPreviewPanel } from "./previewPanel";

let panel: VectorPreviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  panel = new VectorPreviewPanel(context);
  context.subscriptions.push(
    { dispose: () => panel?.dispose() },
    vscode.commands.registerCommand("androidVectorPreview.open", (uri?: vscode.Uri) => panel?.open(uri)),
    vscode.commands.registerCommand("androidVectorPreview.exportSvg", (uri?: vscode.Uri) => panel?.export(uri)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateVectorContext();
      panel?.followActiveEditor(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) updateVectorContext();
      panel?.onDocumentChanged(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      panel?.onDocumentClosed(document);
      updateVectorContext();
    }),
  );
  updateVectorContext();
}

export function deactivate(): void {
  panel?.dispose();
  panel = undefined;
}

function updateVectorContext(): void {
  const text = vscode.window.activeTextEditor?.document.getText() ?? "";
  const isVector = /<(?:[\w.-]+:)?vector\b/.test(text) || /<(?:[\w.-]+:)?animated-vector\b/.test(text);
  void vscode.commands.executeCommand("setContext", "androidVectorPreview.isVector", isVector);
}
