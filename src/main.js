import "./style.css";
import "./stage4.css";
import * as monaco from "monaco-editor";
import EditorWorker from "../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import HtmlWorker from "../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import CssWorker from "../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import TsWorker from "../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "html") return new HtmlWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["javascript", "typescript"].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};

const $ = (selector) => document.querySelector(selector);

const status = $("#connection-status");
const accountStatus = $("#account-status");
const loginButton = $("#open-login");
const registerButton = $("#open-register");
const logoutButton = $("#logout-button");
const loginForm = $("#login-form");
const registerForm = $("#register-form");
const signedInPanel = $("#signed-in-panel");
const authMessage = $("#auth-message");
const welcomeHeading = $("#welcome-heading");
const welcomeDescription = $("#welcome-description");
const accountAvatar = $("#account-avatar");

let currentUser = null;
let projects = [];
let projectsLoading = false;
let activeProject = null;
let editors = {};
let activeLanguage = "html";
let saveTimer = null;
let previewTimer = null;
let messageTimer = null;
let saveInProgress = false;
let saveQueued = false;
let lastSavedSnapshot = "";
let editorClosing = false;

const previewToken =
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

// -------------------------
// AUTHENTICATION
// -------------------------

function showMessage(message, type = "error") {
  authMessage.textContent = message;
  authMessage.className = `auth-message ${type}`;
}

function clearMessage() {
  authMessage.textContent = "";
  authMessage.className = "auth-message hidden";
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;

  button.disabled = busy;
  button.textContent = busy
    ? "Please wait…"
    : form.id === "login-form"
      ? "Sign in"
      : "Create account";
}

function showAuthTab(tab) {
  clearMessage();

  const showLogin = tab === "login";

  loginForm.classList.toggle("hidden", !showLogin);
  registerForm.classList.toggle("hidden", showLogin);
  signedInPanel.classList.add("hidden");

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === tab);
  });
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({
    ok: false,
    error: "Server returned an invalid response.",
  }));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

// -------------------------
// PROJECT DASHBOARD
// -------------------------

function ensureDashboard() {
  if ($("#project-dashboard")) return;

  const dashboard = document.createElement("section");
  dashboard.id = "project-dashboard";
  dashboard.className = "project-dashboard hidden";

  dashboard.innerHTML = `
    <div class="dashboard-heading">
      <div>
        <span class="dashboard-eyebrow">03 / YOUR WORKSPACE</span>
        <h3>Your projects<span class="dashboard-period">.</span></h3>
        <p class="dashboard-description">
          Your web ideas, organized in one place.
        </p>
      </div>
      <button class="button button-primary"
        id="create-project-button" type="button">
        <span>＋</span> New project
      </button>
    </div>

    <div class="project-toolbar">
      <label class="project-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input id="project-search" type="search"
          placeholder="Search your projects..."
          aria-label="Search projects">
      </label>
      <span id="project-count" class="project-count">0 projects</span>
    </div>

    <div id="project-message" class="project-message hidden"
      role="status" aria-live="polite"></div>

    <div id="projects-grid" class="projects-grid-new"></div>
  `;

  signedInPanel.appendChild(dashboard);

  $("#create-project-button").addEventListener("click", createProject);
  $("#project-search").addEventListener("input", renderProjects);
}

function projectMessage(message, type = "error") {
  const element = $("#project-message");
  if (!element) return;

  element.textContent = message;
  element.className = `project-message ${type}`;
}

function clearProjectMessage() {
  const element = $("#project-message");
  if (!element) return;

  element.textContent = "";
  element.className = "project-message hidden";
}

function formatDate(value) {
  if (!value) return "Recently created";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently created";

  return `Updated ${date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function renderProjects() {
  const grid = $("#projects-grid");
  const count = $("#project-count");
  const search = ($("#project-search")?.value || "").trim().toLowerCase();

  if (!grid || !count) return;

  const filtered = projects.filter((project) =>
    String(project.name || "")
      .toLowerCase()
      .includes(search),
  );

  count.textContent = `${projects.length} project${projects.length === 1 ? "" : "s"}`;

  if (projectsLoading) {
    grid.innerHTML = `
      <div class="project-empty">
        <span class="project-empty-icon">◌</span>
        <h4>Loading projects...</h4>
        <p>Getting your workspace ready.</p>
      </div>`;
    return;
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="project-empty">
        <span class="project-empty-icon">${search ? "⌕" : "＋"}</span>
        <h4>${search ? "No matching projects" : "Your canvas is empty"}</h4>
        <p>${
          search
            ? "Try a different project name."
            : "Create your first project and start building something."
        }</p>
        ${
          search
            ? ""
            : `<button class="button button-primary"
                 id="empty-create-button" type="button">
                 Create your first project
               </button>`
        }
      </div>`;

    $("#empty-create-button")?.addEventListener("click", createProject);
    return;
  }

  grid.innerHTML = filtered
    .map(
      (project, index) => `
        <article class="project-card-new">
          <div class="project-card-top">
            <span class="project-card-icon">&lt;/&gt;</span>
            <span class="project-card-number">
              ${String(index + 1).padStart(2, "0")}
            </span>
          </div>

          <div class="project-card-content">
            <h4>${escapeHTML(project.name || "Untitled Project")}</h4>
            <p>HTML · CSS · JavaScript</p>
            <span class="project-card-date">
              ${escapeHTML(
                formatDate(
                  project.updated_at || project.updatedAt || project.created_at,
                ),
              )}
            </span>
          </div>

          <div class="project-card-actions">
            <button class="button button-primary project-open-button"
              type="button" data-action="open"
              data-id="${escapeHTML(project.id)}">
              Open project <span>↗</span>
            </button>

            <button class="project-icon-button"
              type="button" data-action="rename"
              data-id="${escapeHTML(project.id)}"
              aria-label="Rename project" title="Rename">✎</button>

            <button class="project-icon-button danger"
              type="button" data-action="delete"
              data-id="${escapeHTML(project.id)}"
              aria-label="Delete project" title="Delete">×</button>
          </div>
        </article>
      `,
    )
    .join("");

  grid.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const project = projects.find(
        (item) => String(item.id) === button.dataset.id,
      );

      if (!project) return;

      if (button.dataset.action === "open") openProject(project);
      if (button.dataset.action === "rename") renameProject(project);
      if (button.dataset.action === "delete") deleteProject(project);
    });
  });
}

async function loadProjects() {
  if (!currentUser) return;

  ensureDashboard();
  projectsLoading = true;
  renderProjects();
  clearProjectMessage();

  try {
    const data = await apiRequest("/api/projects");
    projects = Array.isArray(data.projects) ? data.projects : [];
  } catch (error) {
    projects = [];
    projectMessage(error.message || "Couldn't load your projects.");
  } finally {
    projectsLoading = false;
    renderProjects();
  }
}

async function createProject() {
  if (!currentUser) return;

  const name = window.prompt("Name your new project:", "My First Project");
  if (name === null) return;

  const trimmedName = name.trim();

  if (!trimmedName) {
    projectMessage("Project name can't be empty.");
    return;
  }

  if (trimmedName.length > 100) {
    projectMessage("Project name must be 100 characters or fewer.");
    return;
  }

  clearProjectMessage();

  try {
    await apiRequest("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: trimmedName }),
    });

    projectMessage("Project created successfully.", "success");
    await loadProjects();
  } catch (error) {
    projectMessage(error.message || "Couldn't create the project.");
  }
}

async function renameProject(project) {
  const currentName = project.name || "Untitled Project";
  const name = window.prompt("Enter a new project name:", currentName);
  if (name === null) return;

  const trimmedName = name.trim();

  if (!trimmedName || trimmedName.length > 100) {
    projectMessage("Project name must be 1–100 characters.");
    return;
  }

  if (trimmedName === currentName) return;

  try {
    await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: trimmedName }),
    });

    projectMessage("Project renamed successfully.", "success");
    await loadProjects();
  } catch (error) {
    projectMessage(error.message || "Couldn't rename the project.");
  }
}

async function deleteProject(project) {
  const name = project.name || "Untitled Project";

  if (!window.confirm(`Delete "${name}"?\n\nThis cannot be undone.`)) {
    return;
  }

  try {
    await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
    });

    projectMessage("Project deleted.", "success");
    await loadProjects();
  } catch (error) {
    projectMessage(error.message || "Couldn't delete the project.");
  }
}

// -------------------------
// CODE EDITOR WORKSPACE
// -------------------------

function ensureEditorWorkspace() {
  if ($("#code-editor-workspace")) return;

  const section = document.createElement("section");
  section.id = "code-editor-workspace";
  section.className = "code-editor-workspace hidden";

  section.innerHTML = `
    <div class="cc-editor-heading">
      <button type="button" class="cc-back-button" id="back-to-projects">
        ← All projects
      </button>

      <div class="cc-editor-project-title">
        <span class="cc-eyebrow">04 / CODE WORKSPACE</span>
        <input id="editor-project-name" maxlength="100"
          aria-label="Project name" value="Untitled Project">
      </div>

      <div class="cc-editor-actions">
        <span id="editor-save-status" class="cc-save-status">Saved</span>
        <button type="button" class="cc-tool-button"
          id="toggle-preview-button" aria-expanded="true">
          Hide Preview
        </button>
        <button type="button" class="cc-tool-button"
          id="editor-run-button">▶ Run</button>
        <button type="button" class="cc-tool-button cc-primary-tool"
          id="editor-save-button">Save</button>
      </div>
    </div>

    <div class="cc-split-workspace">
      <div class="cc-workbench">
        <aside class="cc-editor-sidebar">
          <span class="cc-sidebar-label">EXPLORER</span>
          <div class="cc-sidebar-project">
            ▾ <span id="sidebar-project-name">Untitled Project</span>
          </div>

          <button class="cc-file-button active" type="button"
            data-language="html">
            <span class="cc-file-icon cc-html-icon">5</span> index.html
          </button>

          <button class="cc-file-button" type="button" data-language="css">
            <span class="cc-file-icon cc-css-icon">#</span> style.css
          </button>

          <button class="cc-file-button" type="button"
            data-language="javascript">
            <span class="cc-file-icon cc-js-icon">JS</span> script.js
          </button>

          <div class="cc-sidebar-tip">
            Your files are stored in your CodeCanvas account.
          </div>
        </aside>

        <div class="cc-editor-main">
          <div class="cc-editor-tabs">
            <button class="cc-editor-tab active" type="button"
              data-language="html">◧ index.html</button>
            <button class="cc-editor-tab" type="button"
              data-language="css"># style.css</button>
            <button class="cc-editor-tab" type="button"
              data-language="javascript">JS script.js</button>
          </div>

          <div id="monaco-container" class="cc-monaco-container"
            aria-label="Code editor"></div>

          <div class="cc-editor-statusbar">
            <span id="cc-language-status">HTML</span>
            <span id="cc-cursor-status">Ln 1, Col 1</span>
            <span>UTF-8</span>
            <span>CodeCanvas</span>
          </div>
        </div>
      </div>

      <div class="cc-preview-section" id="cc-preview-pane">
        <div class="cc-preview-heading">
          <div>
            <span class="cc-eyebrow">LIVE ENVIRONMENT</span>
            <h3>Preview</h3>
          </div>

          <div class="cc-preview-actions">
            <span id="preview-status">Waiting to run</span>
            <button type="button" class="cc-tool-button"
              id="refresh-preview-button">↻ Refresh</button>
          </div>
        </div>

        <div class="cc-preview-frame-wrap">
          <iframe id="code-preview-frame"
            title="Project live preview"
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"></iframe>
        </div>

        <div class="cc-console-panel">
          <div class="cc-console-heading">
            <strong>Console</strong>
            <button type="button" id="clear-console-button">Clear</button>
          </div>

          <div id="cc-console-output" class="cc-console-output">
            <div class="cc-console-placeholder">
              Run your project to see console output here.
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="cc-editor-message" class="cc-editor-message hidden"
      role="status" aria-live="polite"></div>
  `;

  signedInPanel.appendChild(section);

  $("#back-to-projects").addEventListener("click", closeEditor);
  $("#editor-run-button").addEventListener("click", runPreview);
  $("#refresh-preview-button").addEventListener("click", runPreview);
  $("#editor-save-button").addEventListener("click", () => saveProject(true));
  $("#clear-console-button").addEventListener("click", clearConsole);

  $("#toggle-preview-button").addEventListener("click", () => {
    const hidden = section.classList.toggle("cc-preview-hidden");
    const button = $("#toggle-preview-button");

    button.textContent = hidden ? "Show Preview" : "Hide Preview";
    button.setAttribute("aria-expanded", String(!hidden));

    requestAnimationFrame(() => {
      Object.values(editors).forEach((editor) => editor.layout());
    });
  });

  $("#editor-project-name").addEventListener("input", () => {
    if (!activeProject) return;

    activeProject.name = $("#editor-project-name").value;
    $("#sidebar-project-name").textContent =
      activeProject.name || "Untitled Project";

    setSaveStatus("Unsaved changes");
    scheduleSave();
  });

  section.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
      switchLanguage(button.dataset.language);
    });
  });

  window.addEventListener("message", handlePreviewMessage);
}

function setSaveStatus(message, state = "") {
  const element = $("#editor-save-status");
  if (!element) return;

  element.textContent = message;
  element.className = `cc-save-status ${state}`;
}

function editorMessage(message, type = "error") {
  const element = $("#cc-editor-message");
  if (!element) return;

  element.textContent = message;
  element.className = `cc-editor-message ${type}`;

  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    element.classList.add("hidden");
  }, 5000);
}

function editorSnapshot() {
  return JSON.stringify({
    name:
      $("#editor-project-name")?.value ??
      activeProject?.name ??
      "Untitled Project",
    html_content: editors.html?.getValue() ?? activeProject?.html_content ?? "",
    css_content: editors.css?.getValue() ?? activeProject?.css_content ?? "",
    js_content:
      editors.javascript?.getValue() ?? activeProject?.js_content ?? "",
  });
}

function createMonacoEditors(project) {
  const container = $("#monaco-container");

  Object.values(editors).forEach((editor) => editor.dispose());
  editors = {};

  const options = {
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: '"DM Mono", Consolas, monospace',
    fontSize: 13,
    lineHeight: 22,
    tabSize: 2,
    insertSpaces: true,
    scrollBeyondLastLine: false,
    padding: { top: 14, bottom: 14 },
    wordWrap: "on",
    renderLineHighlight: "all",
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
  };

  editors.html = monaco.editor.create(container, {
    ...options,
    value: project.html_content || "",
    language: "html",
    ariaLabel: "HTML editor",
  });

  editors.css = monaco.editor.create(container, {
    ...options,
    value: project.css_content || "",
    language: "css",
    ariaLabel: "CSS editor",
  });

  editors.javascript = monaco.editor.create(container, {
    ...options,
    value: project.js_content || "",
    language: "javascript",
    ariaLabel: "JavaScript editor",
  });

  Object.entries(editors).forEach(([language, editor]) => {
    editor.onDidChangeModelContent(() => {
      if (!activeProject) return;

      setSaveStatus("Unsaved changes");
      scheduleSave();
      schedulePreview();

      if (language === activeLanguage) updateCursorStatus(editor);
    });

    editor.onDidChangeCursorPosition(() => {
      if (language === activeLanguage) updateCursorStatus(editor);
    });
  });

  switchLanguage("html");
}

function switchLanguage(language) {
  if (!editors[language]) return;

  activeLanguage = language;

  Object.entries(editors).forEach(([key, editor]) => {
    editor.getDomNode().style.display = key === language ? "block" : "none";
  });

  document
    .querySelectorAll("#code-editor-workspace [data-language]")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.language === language);
    });

  $("#cc-language-status").textContent =
    language === "javascript" ? "JAVASCRIPT" : language.toUpperCase();

  updateCursorStatus(editors[language]);
  editors[language].layout();
  editors[language].focus();
}

function updateCursorStatus(editor) {
  const position = editor?.getPosition();

  if (position) {
    $("#cc-cursor-status").textContent =
      `Ln ${position.lineNumber}, Col ${position.column}`;
  }
}

async function openProject(project) {
  clearProjectMessage();

  try {
    const data = await apiRequest(
      `/api/projects/${encodeURIComponent(project.id)}`,
    );

    if (!data.project) {
      throw new Error("Server did not return the project.");
    }

    activeProject = data.project;
    ensureEditorWorkspace();

    $("#project-dashboard").classList.add("hidden");
    $("#code-editor-workspace").classList.remove("hidden");

    $("#editor-project-name").value = activeProject.name || "Untitled Project";
    $("#sidebar-project-name").textContent =
      activeProject.name || "Untitled Project";

    $("#code-editor-workspace").classList.remove("cc-preview-hidden");
    $("#toggle-preview-button").textContent = "Hide Preview";
    $("#toggle-preview-button").setAttribute("aria-expanded", "true");

    clearConsole();
    createMonacoEditors(activeProject);

    lastSavedSnapshot = editorSnapshot();
    setSaveStatus("Saved", "is-saved");
    runPreview();

    requestAnimationFrame(() => {
      Object.values(editors).forEach((editor) => editor.layout());
    });
  } catch (error) {
    projectMessage(error.message || "Couldn't open this project.");
  }
}

function showDashboard() {
  $("#code-editor-workspace")?.classList.add("hidden");
  $("#project-dashboard")?.classList.remove("hidden");

  editorClosing = false;

  $("#project-dashboard")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

async function closeEditor() {
  if (!activeProject || editorClosing) return;

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (editorSnapshot() !== lastSavedSnapshot) {
    await saveProject(false);
  }

  if (editorSnapshot() !== lastSavedSnapshot) {
    editorMessage("Save failed. Please save your changes before leaving.");
    return;
  }

  editorClosing = true;
  showDashboard();
}

// -------------------------
// AUTOSAVE
// -------------------------

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveProject(false);
  }, 850);
}

async function saveProject(manual = false) {
  if (!activeProject || !currentUser) return;

  if (saveInProgress) {
    saveQueued = true;
    return;
  }

  const snapshot = editorSnapshot();

  if (snapshot === lastSavedSnapshot) {
    if (manual) editorMessage("All changes are already saved.", "success");
    return;
  }

  const payload = JSON.parse(snapshot);

  for (const field of ["html_content", "css_content", "js_content"]) {
    if (new TextEncoder().encode(payload[field]).length > 30000) {
      setSaveStatus("File too large", "is-error");
      editorMessage(`${field.toUpperCase()} exceeds the 30 KB per-file limit.`);
      return;
    }
  }

  if (new TextEncoder().encode(snapshot).length > 95000) {
    setSaveStatus("Project too large", "is-error");
    editorMessage("Combined project code exceeds the current save limit.");
    return;
  }

  saveInProgress = true;
  setSaveStatus("Saving…", "is-saving");

  try {
    const data = await apiRequest(
      `/api/projects/${encodeURIComponent(activeProject.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );

    activeProject = data.project || { ...activeProject, ...payload };
    lastSavedSnapshot = snapshot;

    setSaveStatus("Saved", "is-saved");

    if (manual) {
      editorMessage("Project saved to your account.", "success");
    }

    const projectInList = projects.find(
      (item) => String(item.id) === String(activeProject.id),
    );

    if (projectInList) {
      projectInList.name = payload.name;
      projectInList.updated_at =
        activeProject.updated_at || new Date().toISOString();
    }
  } catch (error) {
    setSaveStatus("Save failed", "is-error");
    editorMessage(
      `${error.message || "Autosave failed."} Your edits remain in this tab.`,
      "error",
    );
  } finally {
    saveInProgress = false;

    if (saveQueued) {
      saveQueued = false;

      if (editorSnapshot() !== lastSavedSnapshot) {
        scheduleSave();
      }
    }
  }
}

// -------------------------
// PREVIEW & CONSOLE
// -------------------------

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 450);
}

function buildPreviewDocument() {
  const html = editors.html?.getValue() || "";
  const css = editors.css?.getValue() || "";
  const js = editors.javascript?.getValue() || "";

  const bridge = `
    (() => {
      const token = ${JSON.stringify(previewToken)};

      const send = (type, args) => {
        try {
          parent.postMessage({
            source: "codecanvas-preview",
            token,
            type,
            args: Array.from(args || []).map((item) => {
              try {
                return typeof item === "string"
                  ? item
                  : JSON.stringify(item);
              } catch {
                return String(item);
              }
            })
          }, "*");
        } catch {}
      };

      for (const level of ["log", "info", "warn", "error"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
          send(level, args);
          original(...args);
        };
      }

      window.addEventListener("error", (event) => {
        send("error", [event.message || "Unknown runtime error"]);
      });

      window.addEventListener("unhandledrejection", (event) => {
        send("error", [
          event.reason?.message || String(event.reason || "Unhandled rejection")
        ]);
      });
    })();
  `;

  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  const safeCss = css.replace(/<\/style/gi, "<\\/style");

  let result = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head><body>${html}</body></html>`;

  const styleTag = `<style>${safeCss}</style>`;
  const scriptTag = `<script>${bridge}<\/script><script>${safeJs}<\/script>`;

  if (/<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${styleTag}</head>`);
  } else {
    result = `${styleTag}${result}`;
  }

  if (/<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, `${scriptTag}</body>`);
  } else {
    result += scriptTag;
  }

  return result;
}

function runPreview() {
  if (!activeProject || !editors.html) return;

  const frame = $("#code-preview-frame");
  if (!frame) return;

  frame.srcdoc = buildPreviewDocument();
  $("#preview-status").textContent = "Running preview";

  setTimeout(() => {
    if ($("#preview-status")) {
      $("#preview-status").textContent = "Preview updated";
    }
  }, 350);
}

function clearConsole() {
  const output = $("#cc-console-output");
  if (!output) return;

  output.innerHTML = `
    <div class="cc-console-placeholder">
      Console cleared. Run your project to see new output here.
    </div>`;
}

function handlePreviewMessage(event) {
  const frame = $("#code-preview-frame");

  if (!frame || event.source !== frame.contentWindow) return;

  const data = event.data;

  if (
    !data ||
    data.source !== "codecanvas-preview" ||
    data.token !== previewToken
  ) {
    return;
  }

  const output = $("#cc-console-output");
  if (!output) return;

  output.querySelector(".cc-console-placeholder")?.remove();

  const row = document.createElement("div");
  const level = ["error", "warn"].includes(data.type) ? data.type : "log";
  row.className = `cc-console-line cc-console-${level}`;

  const label = document.createElement("span");
  label.className = "cc-console-level";
  label.textContent = String(data.type || "log").toUpperCase();

  const message = document.createElement("span");
  message.textContent = Array.isArray(data.args)
    ? data.args.join(" ")
    : String(data.args || "");

  row.append(label, message);
  output.appendChild(row);
  output.scrollTop = output.scrollHeight;
}

// -------------------------
// USER SESSION
// -------------------------

function renderUser(user) {
  currentUser = user;

  const loggedIn = Boolean(user);

  accountStatus.textContent = loggedIn ? `@${user.username}` : "Guest";
  loginButton.classList.toggle("hidden", loggedIn);
  registerButton.classList.toggle("hidden", loggedIn);
  logoutButton.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    loginForm.classList.add("hidden");
    registerForm.classList.add("hidden");
    signedInPanel.classList.remove("hidden");

    welcomeHeading.textContent = `Welcome, ${user.username}!`;
    welcomeDescription.textContent = user.email;
    accountAvatar.textContent = user.username.charAt(0).toUpperCase();

    ensureDashboard();
    $("#project-dashboard").classList.remove("hidden");
    loadProjects();
  } else {
    Object.values(editors).forEach((editor) => editor.dispose());
    editors = {};
    activeProject = null;
    lastSavedSnapshot = "";

    projects = [];
    projectsLoading = false;

    signedInPanel.classList.add("hidden");
    $("#project-dashboard")?.classList.add("hidden");
    $("#code-editor-workspace")?.classList.add("hidden");

    showAuthTab("login");
  }
}

async function checkServer() {
  try {
    const data = await apiRequest("/api/health");
    status.textContent = `${data.app} API connected`;

    const sessionData = await apiRequest("/api/auth/me");
    renderUser(sessionData.user);
  } catch {
    status.textContent = "API not connected";
    showMessage(
      "Can't reach the API. Make sure the CodeCanvas backend is running.",
      "error",
    );
  }
}

loginButton.addEventListener("click", () => {
  showAuthTab("login");
  $("#account").scrollIntoView({ behavior: "smooth" });
});

registerButton.addEventListener("click", () => {
  showAuthTab("register");
  $("#account").scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => showAuthTab(button.dataset.authTab));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  setBusy(loginForm, true);

  const formData = new FormData(loginForm);

  try {
    const data = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: formData.get("identifier"),
        password: formData.get("password"),
      }),
    });

    loginForm.reset();
    renderUser(data.user);
    showMessage("Login successful. Welcome back!", "success");
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(loginForm, false);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  setBusy(registerForm, true);

  const formData = new FormData(registerForm);

  try {
    const data = await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });

    registerForm.reset();
    renderUser(data.user);
    showMessage("Account created successfully.", "success");
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(registerForm, false);
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  clearMessage();

  try {
    const data = await apiRequest("/api/auth/logout", {
      method: "POST",
    });

    renderUser(null);
    showMessage(data.message || "Logged out successfully.", "success");
  } catch (error) {
    showMessage(error.message);
  } finally {
    logoutButton.disabled = false;
  }
});

window.addEventListener("beforeunload", (event) => {
  if (activeProject && editorSnapshot() !== lastSavedSnapshot) {
    event.preventDefault();
    event.returnValue = "";
  }
});

checkServer();
