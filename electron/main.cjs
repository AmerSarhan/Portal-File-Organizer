const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const chokidar = require("chokidar");
const { v4: uuidv4 } = require("uuid");

let mainWindow = null;
let tray = null;
let watchers = new Map();

// --- Config persistence ---

function getConfigDir() {
  const dir = path.join(app.getPath("userData"), "theportal");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRulesPath() {
  return path.join(getConfigDir(), "rules.json");
}

function loadRules() {
  try {
    const data = fs.readFileSync(getRulesPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveRules(rules) {
  fs.writeFileSync(getRulesPath(), JSON.stringify(rules, null, 2));
}

// --- Stats persistence ---

function getStatsPath() {
  return path.join(getConfigDir(), "stats.json");
}

function loadStats() {
  try {
    const data = fs.readFileSync(getStatsPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return { totalMoved: 0, totalBytes: 0, perRule: {}, daily: {} };
  }
}

function saveStats(stats) {
  fs.writeFileSync(getStatsPath(), JSON.stringify(stats, null, 2));
}

function recordMove(ruleId, ruleName, fileSize) {
  const stats = loadStats();
  const today = new Date().toISOString().slice(0, 10);

  stats.totalMoved = (stats.totalMoved || 0) + 1;
  stats.totalBytes = (stats.totalBytes || 0) + fileSize;

  if (!stats.perRule[ruleId]) {
    stats.perRule[ruleId] = { name: ruleName, count: 0, bytes: 0 };
  }
  stats.perRule[ruleId].count += 1;
  stats.perRule[ruleId].bytes += fileSize;
  stats.perRule[ruleId].name = ruleName;

  if (!stats.daily[today]) {
    stats.daily[today] = { count: 0, bytes: 0 };
  }
  stats.daily[today].count += 1;
  stats.daily[today].bytes += fileSize;

  saveStats(stats);
  return stats;
}

// --- Activity log persistence ---

function getActivityPath() {
  return path.join(getConfigDir(), "activity.json");
}

function loadActivity() {
  try {
    const data = fs.readFileSync(getActivityPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveActivity(log) {
  fs.writeFileSync(getActivityPath(), JSON.stringify(log, null, 2));
}

// --- Settings persistence ---

function getSettingsPath() {
  return path.join(getConfigDir(), "settings.json");
}

function loadSettings() {
  try {
    const data = fs.readFileSync(getSettingsPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return { conflictMode: "skip" };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

// --- Undo stack ---

let undoStack = [];

// --- AI Rename ---

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

function getMediaType(ext) {
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return map[ext] || null;
}

async function aiRenameFile(filePath, ext) {
  const keyPath = path.join(getConfigDir(), "apikey");
  let apiKey;
  try {
    apiKey = fs.readFileSync(keyPath, "utf-8").trim();
  } catch {
    return null;
  }
  if (!apiKey) return null;

  const mediaType = getMediaType(ext);
  if (!mediaType) return null;

  try {
    const imageData = fs.readFileSync(filePath);
    const base64 = imageData.toString("base64");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: "text",
                text: "Give this image a short descriptive filename (2-4 words, lowercase, hyphens between words, NO file extension, NO quotes). Reply with ONLY the filename.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.log(`[Portal] AI rename API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    let name = data.content[0].text.trim();
    // Clean up: remove quotes, extension, and invalid chars
    name = name.replace(/['"]/g, "").replace(/\.[a-z]+$/i, "").replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "-").toLowerCase();
    if (!name || name.length < 2) return null;
    console.log(`[Portal] AI rename: "${path.basename(filePath)}" -> "${name}${ext}"`);
    return name + ext;
  } catch (err) {
    console.error(`[Portal] AI rename failed: ${err.message}`);
    return null;
  }
}

// --- File matching + moving ---

async function processFile(filePath, rules) {
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const fileName = path.basename(filePath);

  console.log(`[Portal] New file detected: "${fileName}" in "${dir}" (ext: "${ext}")`);
  console.log(`[Portal] Checking against ${rules.filter(r => r.enabled).length} enabled rules`);

  for (const rule of rules.filter((r) => r.enabled)) {
    const sourceNorm = rule.sourceFolder.replace(/\\/g, "/").toLowerCase();
    const dirNorm = dir.replace(/\\/g, "/").toLowerCase();

    console.log(`[Portal] Rule "${rule.name}": source="${sourceNorm}" vs dir="${dirNorm}"`);

    if (sourceNorm !== dirNorm) {
      console.log(`[Portal]   -> Source folder mismatch, skipping`);
      continue;
    }

    const exts = Array.isArray(rule.extensions) ? rule.extensions : [];
    const extMatch = exts.length === 0 || (ext && exts.some((e) => e.toLowerCase() === ext));
    const nameContains = rule.nameContains || "";
    const nameMatch = !nameContains || fileName.toLowerCase().includes(nameContains.toLowerCase());

    console.log(`[Portal]   -> extMatch=${extMatch} (exts: ${JSON.stringify(exts)})`);
    console.log(`[Portal]   -> nameMatch=${nameMatch} (nameContains: "${nameContains}", fileName: "${fileName}")`);

    if (!extMatch || !nameMatch) {
      console.log(`[Portal]   -> No match, skipping`);
      continue;
    }
    if (exts.length === 0 && !nameContains) {
      console.log(`[Portal]   -> No extensions and no nameContains, skipping (safety)`);
      continue;
    }

    {
      console.log(`[Portal]   -> MATCH! Moving to "${rule.destinationFolder}"`);
      fs.mkdirSync(rule.destinationFolder, { recursive: true });

      // AI rename if enabled and file is an image (skip if matched by nameContains — original name is meaningful)
      let finalName = fileName;
      if (rule.aiRename && IMAGE_EXTENSIONS.has(ext) && !rule.nameContains) {
        console.log(`[Portal]   -> AI rename enabled, analyzing image...`);
        const aiName = await aiRenameFile(filePath, ext);
        if (aiName) {
          finalName = aiName;
          console.log(`[Portal]   -> AI renamed to "${finalName}"`);
        } else {
          console.log(`[Portal]   -> AI rename failed, keeping original name`);
        }
      }

      let destPath = path.join(rule.destinationFolder, finalName);

      if (fs.existsSync(destPath)) {
        const settings = loadSettings();
        const mode = settings.conflictMode || "skip";
        if (mode === "skip") {
          console.log(`[Portal]   -> File already exists at dest, skipping`);
          continue;
        } else if (mode === "rename") {
          // Append -1, -2, etc.
          const parsed = path.parse(finalName);
          let counter = 1;
          while (fs.existsSync(destPath)) {
            finalName = `${parsed.name}-${counter}${parsed.ext}`;
            destPath = path.join(rule.destinationFolder, finalName);
            counter++;
          }
          console.log(`[Portal]   -> Conflict resolved by rename: "${finalName}"`);
        } else if (mode === "overwrite") {
          console.log(`[Portal]   -> Overwriting existing file at dest`);
          fs.unlinkSync(destPath);
        }
      }

      try {
        const fileSize = fs.statSync(filePath).size;
        fs.renameSync(filePath, destPath);
        console.log(`[Portal]   -> Moved successfully! (${fileSize} bytes)`);

        recordMove(rule.id, rule.name, fileSize);

        undoStack.push({ from: destPath, to: filePath, fileName: finalName, originalName: fileName, timestamp: Date.now() });
        if (undoStack.length > 50) undoStack.shift();

        const entry = {
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          fileName: finalName,
          from: rule.sourceFolder,
          to: rule.destinationFolder,
          ruleName: rule.name,
          fileSize,
          renamedFrom: finalName !== fileName ? fileName : undefined,
        };
        return entry;
      } catch (err) {
        console.error(`[Portal]   -> FAILED to move: ${err.message}`);
      }
    }
  }
  console.log(`[Portal] No matching rule found for "${fileName}"`);
  return null;
}

// --- Watcher management ---

let activityLog = [];

function addActivity(entry) {
  activityLog.unshift(entry);
  if (activityLog.length > 200) activityLog.length = 200;
  saveActivity(activityLog);
}

function showNotification(entry) {
  if (Notification.isSupported()) {
    const n = new Notification({
      title: "The Portal",
      body: `Moved "${entry.fileName}" to ${path.basename(entry.to)}`,
      silent: true,
    });
    n.show();
  }
}

function rebuildWatchers() {
  // Stop all existing watchers
  for (const [, watcher] of watchers) {
    watcher.close();
  }
  watchers.clear();

  const rules = loadRules();
  const enabledRules = rules.filter((r) => r.enabled);

  // Group by source folder
  const sources = new Map();
  for (const rule of enabledRules) {
    if (!sources.has(rule.sourceFolder)) {
      sources.set(rule.sourceFolder, []);
    }
    sources.get(rule.sourceFolder).push(rule);
  }

  console.log(`[Portal] Rebuilding watchers. ${enabledRules.length} enabled rules, ${sources.size} source folders`);

  for (const [source, sourceRules] of sources) {
    if (!fs.existsSync(source)) {
      console.log(`[Portal] Source folder does not exist, skipping: "${source}"`);
      continue;
    }

    console.log(`[Portal] Watching: "${source}" (${sourceRules.length} rules)`);
    const watcher = chokidar.watch(source, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    });

    watcher.on("add", async (filePath) => {
      const entry = await processFile(filePath, sourceRules);
      if (entry) {
        addActivity(entry);
        showNotification(entry);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("file-moved", entry);
        }
      }
    });

    watchers.set(source, watcher);
  }
}

// --- IPC Handlers ---

function setupIPC() {
  ipcMain.handle("get-rules", () => loadRules());

  ipcMain.handle("add-rule", (_event, rule) => {
    const rules = loadRules();
    rules.push(rule);
    saveRules(rules);
    rebuildWatchers();
    return rules;
  });

  ipcMain.handle("update-rule", (_event, rule) => {
    const rules = loadRules();
    const idx = rules.findIndex((r) => r.id === rule.id);
    if (idx !== -1) rules[idx] = rule;
    saveRules(rules);
    rebuildWatchers();
    return rules;
  });

  ipcMain.handle("delete-rule", (_event, id) => {
    let rules = loadRules();
    rules = rules.filter((r) => r.id !== id);
    saveRules(rules);
    rebuildWatchers();
    return rules;
  });

  ipcMain.handle("toggle-rule", (_event, id) => {
    const rules = loadRules();
    const rule = rules.find((r) => r.id === id);
    if (rule) rule.enabled = !rule.enabled;
    saveRules(rules);
    rebuildWatchers();
    return rules;
  });

  ipcMain.handle("get-activity", () => activityLog);

  ipcMain.handle("get-stats", () => loadStats());

  ipcMain.handle("undo-last-move", () => {
    if (undoStack.length === 0) return { error: "Nothing to undo" };
    const last = undoStack.pop();
    try {
      if (fs.existsSync(last.from)) {
        // Restore to original path with original filename
        const restorePath = path.join(path.dirname(last.to), last.originalName || last.fileName);
        fs.renameSync(last.from, restorePath);
        console.log(`[Portal] Undo: moved "${last.fileName}" back as "${path.basename(restorePath)}"`);
        // Remove from activity log and persist
        const idx = activityLog.findIndex((a) => a.fileName === last.fileName);
        if (idx !== -1) activityLog.splice(idx, 1);
        saveActivity(activityLog);
        return { success: true, fileName: last.originalName || last.fileName };
      }
      return { error: "File no longer exists at destination" };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Organize Now — scan all source folders and process existing files
  ipcMain.handle("organize-now", async () => {
    const rules = loadRules().filter((r) => r.enabled);
    let movedCount = 0;
    const entries = [];

    for (const rule of rules) {
      if (!fs.existsSync(rule.sourceFolder)) continue;
      const files = fs.readdirSync(rule.sourceFolder);
      for (const file of files) {
        const filePath = path.join(rule.sourceFolder, file);
        // Skip directories
        try {
          if (fs.statSync(filePath).isDirectory()) continue;
        } catch { continue; }

        const entry = await processFile(filePath, [rule]);
        if (entry) {
          addActivity(entry);
          entries.push(entry);
          movedCount++;
        }
      }
    }

    // Notify renderer of all moves
    if (mainWindow && !mainWindow.isDestroyed()) {
      for (const entry of entries) {
        mainWindow.webContents.send("file-moved", entry);
      }
    }

    if (movedCount > 0) {
      showNotification({ fileName: `${movedCount} file${movedCount > 1 ? "s" : ""}`, to: "their destinations" });
    }

    return { count: movedCount };
  });

  // Auto-start
  ipcMain.handle("get-auto-start", () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("set-auto-start", (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return enabled;
  });

  // Conflict mode
  ipcMain.handle("get-settings", () => loadSettings());

  ipcMain.handle("save-settings", (_event, newSettings) => {
    const settings = loadSettings();
    Object.assign(settings, newSettings);
    saveSettings(settings);
    return settings;
  });

  ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // Window controls
  ipcMain.handle("minimize-window", () => mainWindow.minimize());
  ipcMain.handle("maximize-window", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle("close-window", () => mainWindow.close());

  // API key management
  ipcMain.handle("get-api-key", () => {
    try {
      const keyPath = path.join(getConfigDir(), "apikey");
      return fs.readFileSync(keyPath, "utf-8").trim();
    } catch {
      return "";
    }
  });

  ipcMain.handle("save-api-key", (_event, key) => {
    const keyPath = path.join(getConfigDir(), "apikey");
    fs.writeFileSync(keyPath, key.trim());
    return true;
  });

  // Claude AI - parse natural language into a rule
  ipcMain.handle("ai-create-rule", async (_event, prompt) => {
    const keyPath = path.join(getConfigDir(), "apikey");
    let apiKey;
    try {
      apiKey = fs.readFileSync(keyPath, "utf-8").trim();
    } catch {
      return { error: "No API key configured. Add your key in Settings." };
    }

    if (!apiKey) {
      return { error: "No API key configured. Add your key in Settings." };
    }

    const os = require("os");
    const userHome = os.homedir().replace(/\\/g, "/");

    const systemPrompt = [
      "You are a file organization assistant. The user will describe a rule for organizing files in natural language. You must respond with ONLY a valid JSON object (no markdown, no explanation) representing the rule.",
      "",
      "The JSON must have these fields:",
      '- "name": string - a short name for the rule',
      '- "sourceFolder": string - the Windows folder path to watch (use forward slashes like C:/Users/Name/Downloads)',
      '- "extensions": string[] - array of file extensions including the dot (e.g. [".pdf", ".doc"]). Can be empty [] if matching by name only.',
      '- "nameContains": string - optional substring the filename must contain (e.g. "invoice", "report"). Use empty string "" if not needed.',
      '- "destinationFolder": string - the Windows folder path to move files to (use forward slashes)',
      "",
      "Common folders for this user:",
      "- Downloads: " + userHome + "/Downloads",
      "- Documents: " + userHome + "/Documents",
      "- Desktop: " + userHome + "/Desktop",
      "- Pictures: " + userHome + "/Pictures",
      "- Music: " + userHome + "/Music",
      "- Videos: " + userHome + "/Videos",
      "",
      'If the user says something vague like "documents" or "my downloads", use the paths above. Always respond with valid JSON only.',
    ].join("\n");

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 401) {
          return { error: "Invalid API key. Check your key in Settings." };
        }
        return { error: `API error (${response.status}): ${errBody}` };
      }

      const data = await response.json();
      const text = data.content[0].text.trim();

      // Parse the JSON from Claude's response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { error: "Could not parse AI response. Try rephrasing." };
      }

      // Fix unescaped backslashes in Windows paths before parsing
      const cleanedJson = jsonMatch[0].replace(/\\(?!["\\/bfnrtu])/g, "/");
      const parsed = JSON.parse(cleanedJson);

      // Validate required fields
      if (!parsed.name || !parsed.sourceFolder || !parsed.extensions || !parsed.destinationFolder) {
        return { error: "AI response missing required fields. Try being more specific." };
      }

      // Add missing fields
      parsed.id = uuidv4();
      parsed.aiRename = false;
      parsed.enabled = true;
      parsed.createdAt = new Date().toISOString();

      return { rule: parsed };
    } catch (err) {
      return { error: `Failed to reach Claude API: ${err.message}` };
    }
  });
}

// --- Window + Tray ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: "The Portal",
    frame: false,
    backgroundColor: "#0b0e11",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Generate a simple teal diamond icon for the tray
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = 12;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      const inside = (dx / r + dy / r) <= 1;
      const i = (y * size + x) * 4;
      if (inside) {
        canvas[i] = 45;     // R
        canvas[i + 1] = 212; // G
        canvas[i + 2] = 191; // B
        canvas[i + 3] = 255; // A
      }
    }
  }
  const icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open The Portal",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("The Portal - File Organizer");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// --- App lifecycle ---

app.whenReady().then(() => {
  activityLog = loadActivity();
  setupIPC();
  createWindow();
  createTray();
  rebuildWatchers();
});

app.on("window-all-closed", (e) => {
  // Don't quit — stay in tray
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
