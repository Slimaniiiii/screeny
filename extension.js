"use strict";
const { readFile, writeFile } = require("fs").promises;
const vscode = require("vscode");
const path = require("path");
const { homedir } = require("os");

const viewerRead = async (htmlPath, panel) =>
  (await readFile(htmlPath, "utf-8"))
    .replace(/%CSP_SOURCE%/gu, panel.webview.cspSource)
    .replace(
      /(src|href)="([^"]*)"/gu,
      (_, type, src) =>
        `${type}="${panel.webview.asWebviewUri(
          vscode.Uri.file(path.resolve(htmlPath, "..", src))
        )}"`
    );

const options = (group, keys) => {
  const settings = vscode.workspace.getConfiguration(group, null);
  const editor = vscode.window.activeTextEditor;
  const language = editor && editor.document && editor.document.languageId;
  const languageSettings =
    language &&
    vscode.workspace.getConfiguration(null, null).get(`[${language}]`);
  return keys.reduce((acc, k) => {
    acc[k] = languageSettings && languageSettings[`${group}.${k}`];
    if (acc[k] == null) acc[k] = settings.get(k);
    return acc;
  }, {});
};

const getConfig = () => {
  const editorSettings = options("editor", ["fontLigatures", "tabSize"]);
  const editor = vscode.window.activeTextEditor;
  if (editor) editorSettings.tabSize = editor.options.tabSize;

  const extensionSettings = options("screeny", [
    "backgroundColor",
    "boxShadow",
    "containerPadding",
    "roundedCorners",
    "showWindowControls",
    "showWindowTitle",
    "showLineNumbers",
    "realLineNumbers",
    "transparentBackground",
    "target",
    "shutterAction",
  ]);

  const selection = editor && editor.selection;
  const startLine = extensionSettings.realLineNumbers
    ? selection
      ? selection.start.line
      : 0
    : 0;

  let windowTitle = "";
  if (editor && extensionSettings.showWindowTitle) {
    const activeFileName = editor.document.uri.path.split("/").pop();
    windowTitle = `${vscode.workspace.name} - ${activeFileName}`;
  }

  return {
    ...editorSettings,
    ...extensionSettings,
    startLine,
    windowTitle,
  };
};

const createPanel = async (context) => {
  const panel = vscode.window.createWebviewPanel(
    "screeny",
    "screeny",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(context.extensionPath)],
    }
  );
  panel.webview.html = await viewerRead(
    path.resolve(context.extensionPath, "webview/index.html"),
    panel
  );

  return panel;
};

let lastUsedImageUri = vscode.Uri.file(
  path.resolve(homedir(), "Desktop/save.png")
);
const saveImage = async (data) => {
  const uri = await vscode.window.showSaveDialog({
    filters: { Images: ["png"] },
    defaultUri: lastUsedImageUri,
  });
  lastUsedImageUri = uri;
  uri && writeFile(uri.fsPath, Buffer.from(data, "base64"));
};

const hasOneSelection = (selections) =>
  selections && selections.length === 1 && !selections[0].isEmpty;

const runCommand = async (context) => {
  const panel = await createPanel(context);

  const update = async () => {
    await vscode.commands.executeCommand(
      "editor.action.clipboardCopyWithSyntaxHighlightingAction"
    );
    panel.webview.postMessage({ type: "update", ...getConfig() });
  };

  const flash = () => panel.webview.postMessage({ type: "flash" });

  panel.webview.onDidReceiveMessage(async ({ type, data }) => {
    // if (type === 'save') {
    flash();
    await saveImage(data);
    // } else {
    //   vscode.window.showErrorMessage(`screeny : Unknown shutterAction "${type}"`);
    // }
  });

  const selectionHandler = vscode.window.onDidChangeTextEditorSelection(
    (e) => hasOneSelection(e.selections) && update()
  );
  panel.onDidDispose(() => selectionHandler.dispose());

  const editor = vscode.window.activeTextEditor;
  if (editor && hasOneSelection(editor.selections)) update();
};

module.exports.activate = (context) =>
  context.subscriptions.push(
    vscode.commands.registerCommand("screeny.start", () => runCommand(context))
  );
