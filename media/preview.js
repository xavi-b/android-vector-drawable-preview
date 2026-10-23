const vscode = acquireVsCodeApi();
const previous = vscode.getState() || {};

const fileName = document.getElementById("fileName");
const dims = document.getElementById("dims");
const canvas = document.getElementById("canvas");
const stage = document.getElementById("stage");
const warnings = document.getElementById("warnings");
const backgroundSelect = document.getElementById("background");
const nightButton = document.getElementById("night");
const mirrorButton = document.getElementById("mirror");
const followButton = document.getElementById("follow");
const zoomLabel = document.getElementById("zoomLabel");

let scale = typeof previous.scale === "number" ? previous.scale : null;
let userZoom = scale != null;
let background = previous.background || "";
let mirror = previous.mirror === true;
let widthDp = 24;
let heightDp = 24;
let fitAttempts = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;

mirrorButton.setAttribute("aria-pressed", String(mirror));

function persist() {
  vscode.setState({ scale: userZoom ? scale : null, background, mirror });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatScale(value) {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}×`;
}

function formatDp(value) {
  return String(Math.round(value * 10) / 10);
}

function applyBackground() {
  canvas.classList.remove("checker", "light", "dark");
  canvas.classList.add(background || "checker");
  backgroundSelect.value = background || "checker";
}

function applyMirror() {
  stage.classList.toggle("mirrored", mirror);
}

function applyScale() {
  const svg = stage.querySelector("svg");
  if (!svg || !scale || !widthDp || !heightDp) return;
  svg.style.width = `${Math.max(1, Math.floor(widthDp * scale))}px`;
  svg.style.height = `${Math.max(1, Math.floor(heightDp * scale))}px`;
  zoomLabel.textContent = formatScale(scale);
}

function fit() {
  const availableWidth = canvas.clientWidth - 48;
  const availableHeight = canvas.clientHeight - 48;
  if ((availableWidth < 20 || availableHeight < 20) && fitAttempts < 12) {
    fitAttempts += 1;
    requestAnimationFrame(fit);
    return;
  }
  fitAttempts = 0;
  if (!widthDp || !heightDp) return;
  userZoom = false;
  scale = clamp(Math.min(availableWidth / widthDp, availableHeight / heightDp), 0.25, 64);
  applyScale();
  persist();
}

function zoomBy(factor) {
  userZoom = true;
  scale = clamp((scale || 1) * factor, 0.25, 64);
  applyScale();
  persist();
}

function showMessage(text, isError) {
  stage.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.className = isError ? "message error" : "message";
  paragraph.textContent = text;
  stage.appendChild(paragraph);
  zoomLabel.textContent = "Fit";
}

function mountSvg(markup) {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (!parsed.documentElement || parsed.querySelector("parsererror")) {
    showMessage("The preview SVG could not be displayed.", true);
    return;
  }
  stage.replaceChildren(document.importNode(parsed.documentElement, true));
  applyMirror();
  if (!userZoom) requestAnimationFrame(fit);
  else applyScale();
}

function showWarnings(list) {
  warnings.replaceChildren();
  if (!list || list.length === 0) {
    warnings.hidden = true;
    return;
  }
  warnings.hidden = false;
  for (const text of list) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    warnings.appendChild(paragraph);
  }
}

function currentSvg() {
  const svg = stage.querySelector("svg");
  if (!svg) return "";
  const clone = svg.cloneNode(true);
  clone.style.width = "";
  clone.style.height = "";
  if (mirror) {
    const root = clone.querySelector("[data-root]");
    const viewportWidth = clone.getAttribute("data-viewport-width") || "0";
    if (root) {
      const existing = root.getAttribute("transform");
      const flip = `translate(${viewportWidth}, 0) scale(-1, 1)`;
      root.setAttribute("transform", existing ? `${flip} ${existing}` : flip);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

function onMessage(event) {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "requestExport") {
    vscode.postMessage({ type: "exportSvg", svg: currentSvg() });
    return;
  }
  if (message.type === "error") {
    fileName.textContent = message.fileName || "Vector Drawable";
    fileName.title = fileName.textContent;
    dims.textContent = "";
    showWarnings([]);
    showMessage(message.message || "Could not render this file.", true);
    nightButton.setAttribute("aria-pressed", String(!!message.night));
    followButton.setAttribute("aria-pressed", String(message.follow !== false));
    if (!background) background = message.defaultBackground || "checker";
    applyBackground();
    return;
  }
  if (message.type !== "update") return;

  fileName.textContent = message.fileName || "Vector Drawable";
  fileName.title = fileName.textContent;
  widthDp = message.widthDp || message.viewportWidth || 24;
  heightDp = message.heightDp || message.viewportHeight || 24;
  dims.textContent = `${formatDp(message.widthDp)} × ${formatDp(message.heightDp)} dp · viewport ${formatDp(message.viewportWidth)} × ${formatDp(message.viewportHeight)}${message.autoMirrored ? " · autoMirrored" : ""}`;
  showWarnings(message.warnings || []);
  nightButton.setAttribute("aria-pressed", String(!!message.night));
  followButton.setAttribute("aria-pressed", String(message.follow !== false));
  if (!background) background = message.defaultBackground || "checker";
  applyBackground();
  mountSvg(message.svg || "");
}

document.getElementById("zoomOut").addEventListener("click", () => zoomBy(1 / 1.25));
document.getElementById("zoomIn").addEventListener("click", () => zoomBy(1.25));
document.getElementById("zoomLabel").addEventListener("click", fit);
document.getElementById("fit").addEventListener("click", fit);
backgroundSelect.addEventListener("change", () => {
  background = backgroundSelect.value;
  applyBackground();
  persist();
});
nightButton.addEventListener("click", () => {
  const next = nightButton.getAttribute("aria-pressed") !== "true";
  nightButton.setAttribute("aria-pressed", String(next));
  vscode.postMessage({ type: "setNight", night: next });
});
mirrorButton.addEventListener("click", () => {
  mirror = !mirror;
  mirrorButton.setAttribute("aria-pressed", String(mirror));
  applyMirror();
  persist();
});
followButton.addEventListener("click", () => {
  const next = followButton.getAttribute("aria-pressed") !== "true";
  followButton.setAttribute("aria-pressed", String(next));
  vscode.postMessage({ type: "setFollow", follow: next });
});
document.getElementById("copy").addEventListener("click", () => {
  const svg = currentSvg();
  if (svg) vscode.postMessage({ type: "copySvg", svg });
});
document.getElementById("export").addEventListener("click", () => {
  const svg = currentSvg();
  if (svg) vscode.postMessage({ type: "exportSvg", svg });
});

canvas.addEventListener("dblclick", fit);
canvas.addEventListener(
  "wheel",
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  },
  { passive: false },
);
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  canvas.scrollLeft -= event.clientX - lastX;
  canvas.scrollTop -= event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
});
function stopDragging() {
  dragging = false;
  canvas.classList.remove("dragging");
}
canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomBy(1.25);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomBy(1 / 1.25);
  } else if (event.key === "0") {
    event.preventDefault();
    fit();
  }
});

window.addEventListener("message", onMessage);
applyBackground();
applyMirror();
vscode.postMessage({ type: "ready" });
