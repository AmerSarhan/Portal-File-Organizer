import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Rule, ActivityEntry, Stats } from "./types";
import "./App.css";

const EXTENSION_PRESETS: Record<string, string[]> = {
  Documents: [".pdf", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".ppt", ".pptx", ".csv"],
  Images: [".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico"],
  Videos: [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"],
  Music: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a"],
  Archives: [".zip", ".rar", ".7z", ".tar", ".gz"],
  Code: [".js", ".ts", ".py", ".java", ".cpp", ".html", ".css", ".json"],
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

type View = "dashboard" | "rules" | "settings";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

function App() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [stats, setStats] = useState<Stats>({ totalMoved: 0, totalBytes: 0, perRule: {}, daily: {} });

  // Editor state
  const [editName, setEditName] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editDest, setEditDest] = useState("");
  const [editExtensions, setEditExtensions] = useState<string[]>([]);
  const [editNameContains, setEditNameContains] = useState("");
  const [editAiRename, setEditAiRename] = useState(false);
  const [customExt, setCustomExt] = useState("");

  // Settings state
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename" | "overwrite">("skip");
  const [organizing, setOrganizing] = useState(false);

  // AI state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(message: string, type: Toast["type"] = "success") {
    const id = uuidv4();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  const loadData = useCallback(async () => {
    const r = await window.api.getRules();
    setRules(r);
    const a = await window.api.getActivity();
    setActivity(a);
    const s = await window.api.getStats();
    setStats(s);
    const key = await window.api.getApiKey();
    setHasApiKey(!!key);
    if (key) setApiKey(key);
    const as = await window.api.getAutoStart();
    setAutoStart(as);
    const settings = await window.api.getSettings();
    setConflictMode(settings.conflictMode || "skip");
  }, []);

  useEffect(() => {
    loadData();
    window.api.onFileMoved((entry) => {
      setActivity((prev) => [entry, ...prev].slice(0, 100));
      addToast(`Moved ${entry.fileName}`);
      // Refresh stats
      window.api.getStats().then(setStats);
    });
  }, [loadData]);

  const selectedRule = rules.find((r) => r.id === selectedRuleId);

  function startNewRule() {
    setView("rules");
    setIsEditing(true);
    setSelectedRuleId(null);
    setEditName("");
    setEditSource("");
    setEditDest("");
    setEditExtensions([]);
    setEditNameContains("");
    setEditAiRename(false);
    setCustomExt("");
  }

  function startEditRule(rule: Rule) {
    setIsEditing(true);
    setSelectedRuleId(rule.id);
    setEditName(rule.name);
    setEditSource(rule.sourceFolder);
    setEditDest(rule.destinationFolder);
    setEditExtensions([...rule.extensions]);
    setEditNameContains(rule.nameContains || "");
    setEditAiRename(rule.aiRename || false);
    setCustomExt("");
  }

  async function saveRule() {
    if (!editName || !editSource || !editDest || (editExtensions.length === 0 && !editNameContains)) return;

    const rule: Rule = {
      id: selectedRuleId || uuidv4(),
      name: editName,
      sourceFolder: editSource,
      extensions: editExtensions,
      nameContains: editNameContains,
      destinationFolder: editDest,
      aiRename: editAiRename,
      enabled: selectedRule?.enabled ?? true,
      createdAt: selectedRule?.createdAt ?? new Date().toISOString(),
    };

    let updated: Rule[];
    if (selectedRuleId) {
      updated = await window.api.updateRule(rule);
      addToast(`Updated "${rule.name}"`, "info");
    } else {
      updated = await window.api.addRule(rule);
      addToast(`Created "${rule.name}"`);
    }
    setRules(updated);
    setSelectedRuleId(rule.id);
    setIsEditing(false);
  }

  function cancelEdit() {
    setIsEditing(false);
    if (!selectedRuleId) setSelectedRuleId(null);
  }

  async function deleteRule(id: string) {
    const name = rules.find((r) => r.id === id)?.name;
    const updated = await window.api.deleteRule(id);
    setRules(updated);
    setSelectedRuleId(null);
    setIsEditing(false);
    addToast(`Deleted "${name}"`, "info");
  }

  async function toggleRule(id: string) {
    const updated = await window.api.toggleRule(id);
    setRules(updated);
  }

  async function pickFolder(target: "source" | "dest") {
    const folder = await window.api.selectFolder();
    if (folder) {
      if (target === "source") setEditSource(folder);
      else setEditDest(folder);
    }
  }

  function toggleExtension(ext: string) {
    setEditExtensions((prev) =>
      prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext]
    );
  }

  function addCustomExt() {
    let ext = customExt.trim().toLowerCase();
    if (!ext) return;
    if (!ext.startsWith(".")) ext = "." + ext;
    if (!editExtensions.includes(ext)) {
      setEditExtensions((prev) => [...prev, ext]);
    }
    setCustomExt("");
  }

  function selectPreset(name: string) {
    const exts = EXTENSION_PRESETS[name];
    setEditExtensions(exts);
    if (!editName) setEditName(name);
  }

  async function handleSaveApiKey() {
    await window.api.saveApiKey(apiKey);
    setHasApiKey(!!apiKey.trim());
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  }

  async function handleAiCreate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiStatus("Thinking...");

    const result = await window.api.aiCreateRule(aiPrompt);

    if (result.error) {
      setAiStatus(result.error);
      setAiLoading(false);
      return;
    }

    if (result.rule) {
      const updated = await window.api.addRule(result.rule);
      setRules(updated);
      setSelectedRuleId(result.rule.id);
      setIsEditing(false);
      setView("rules");
      setAiPrompt("");
      setAiStatus("");
      setAiLoading(false);
      addToast(`AI created "${result.rule.name}"`);
    }
  }

  async function handleUndo() {
    const result = await window.api.undoLastMove();
    if (result.success) {
      addToast(`Undid move: ${result.fileName}`, "info");
      const a = await window.api.getActivity();
      setActivity(a);
      const s = await window.api.getStats();
      setStats(s);
    } else {
      addToast(result.error || "Nothing to undo", "error");
    }
  }

  async function handleOrganizeNow() {
    setOrganizing(true);
    const result = await window.api.organizeNow();
    setOrganizing(false);
    if (result.count > 0) {
      addToast(`Organized ${result.count} file${result.count > 1 ? "s" : ""}!`);
      const a = await window.api.getActivity();
      setActivity(a);
      const s = await window.api.getStats();
      setStats(s);
    } else {
      addToast("No files to organize", "info");
    }
  }

  async function handleAutoStartToggle() {
    const newVal = !autoStart;
    await window.api.setAutoStart(newVal);
    setAutoStart(newVal);
    addToast(newVal ? "Auto-start enabled" : "Auto-start disabled", "info");
  }

  async function handleConflictMode(mode: "skip" | "rename" | "overwrite") {
    setConflictMode(mode);
    await window.api.saveSettings({ conflictMode: mode });
  }

  const enabledCount = rules.filter((r) => r.enabled).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = stats.daily[today] || { count: 0, bytes: 0 };

  // Last 7 days for mini chart
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return { day: d.toLocaleDateString("en", { weekday: "short" }), count: stats.daily[key]?.count || 0 };
  });
  const maxCount = Math.max(...last7.map((d) => d.count), 1);

  return (
    <div className="app">
      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>

      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-drag">
          <span className="titlebar-icon">&#x25C6;</span>
          <span className="titlebar-text">The Portal</span>
          <span className="titlebar-badge">{enabledCount} active</span>
        </div>
        <div className="titlebar-controls">
          <button onClick={() => window.api.minimizeWindow()} className="tb-btn">&#x2500;</button>
          <button onClick={() => window.api.maximizeWindow()} className="tb-btn">&#x25A1;</button>
          <button onClick={() => window.api.closeWindow()} className="tb-btn tb-close">&#x2715;</button>
        </div>
      </div>

      <div className="main-layout">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <h2>Rules</h2>
            <button className="btn-new" onClick={startNewRule}>+ New</button>
          </div>

          {/* Sidebar nav */}
          <div className="sidebar-nav">
            <button
              className={`nav-btn ${view === "dashboard" ? "active" : ""}`}
              onClick={() => { setView("dashboard"); setSelectedRuleId(null); }}
            >
              Dashboard
            </button>
          </div>

          <div className="rule-list">
            {rules.length === 0 && (
              <p className="empty-msg">No rules yet. Create one to get started.</p>
            )}
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`rule-item ${selectedRuleId === rule.id && view === "rules" ? "active" : ""}`}
                onClick={() => {
                  setSelectedRuleId(rule.id);
                  setIsEditing(false);
                  setView("rules");
                }}
              >
                <div className="rule-item-header">
                  <span className="rule-name">{rule.name}</span>
                  <button
                    className={`toggle-btn ${rule.enabled ? "on" : "off"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRule(rule.id);
                    }}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <span className="rule-exts">
                  {[
                    rule.nameContains ? `"${rule.nameContains}"` : "",
                    rule.extensions.length > 0 ? rule.extensions.join(", ") : "",
                  ].filter(Boolean).join(" \u00B7 ") || "Any file"}
                </span>
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <button
              className="btn-settings"
              onClick={() => setView(view === "settings" ? "dashboard" : "settings")}
            >
              {view === "settings" ? "< Back" : "Settings"}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="content">
          {/* AI Input Bar */}
          {hasApiKey && (view === "rules" || view === "dashboard") && (
            <div className="ai-input-section">
              <div className="ai-input-row">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe a rule... e.g. 'move PDFs from downloads to my documents'"
                  onKeyDown={(e) => e.key === "Enter" && !aiLoading && handleAiCreate()}
                />
                <button className="btn-ai" onClick={handleAiCreate} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? "..." : "Create with AI"}
                </button>
              </div>
              {aiStatus && (
                <div className={`ai-status ${aiLoading ? "loading" : aiStatus.startsWith("Created") ? "" : "error"}`}>
                  {aiStatus}
                </div>
              )}
            </div>
          )}

          {view === "dashboard" ? (
            <div className="dashboard">
              {/* Stats cards */}
              <div className="stats-row">
                <div className="stat-card">
                  <span className="stat-value">{todayStats.count}</span>
                  <span className="stat-label">Moved Today</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{formatBytes(todayStats.bytes)}</span>
                  <span className="stat-label">Today's Volume</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.totalMoved}</span>
                  <span className="stat-label">Total Moved</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{formatBytes(stats.totalBytes)}</span>
                  <span className="stat-label">Total Volume</span>
                </div>
              </div>

              {/* 7-day chart */}
              <div className="chart-section">
                <h3>Last 7 Days</h3>
                <div className="mini-chart">
                  {last7.map((d, i) => (
                    <div key={i} className="chart-col">
                      <div className="chart-bar-wrap">
                        <div
                          className="chart-bar"
                          style={{ height: `${(d.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="chart-label">{d.day}</span>
                      <span className="chart-count">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-rule stats */}
              <div className="per-rule-section">
                <h3>Per Rule</h3>
                {Object.entries(stats.perRule).length === 0 && (
                  <p className="empty-msg">No data yet. Stats appear as files are organized.</p>
                )}
                {Object.entries(stats.perRule).map(([id, s]) => (
                  <div key={id} className="per-rule-row">
                    <span className="per-rule-name">{s.name}</span>
                    <span className="per-rule-count">{s.count} files</span>
                    <span className="per-rule-bytes">{formatBytes(s.bytes)}</span>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="dashboard-actions">
                <button className="btn-organize" onClick={handleOrganizeNow} disabled={organizing}>
                  {organizing ? "Organizing..." : "Organize Now"}
                </button>
                <button className="btn-undo" onClick={handleUndo}>
                  Undo Last Move
                </button>
              </div>
            </div>
          ) : view === "settings" ? (
            <div className="settings">
              <h2>Settings</h2>
              <div className="settings-section">
                <h3>Claude API Key</h3>
                <p className="empty-msg" style={{ textAlign: "left", padding: "0 0 10px 0" }}>
                  Add your Anthropic API key to create rules with natural language. Your key is stored locally only.
                </p>
                <div className="api-key-input">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                  />
                  <button className="btn-key-save" onClick={handleSaveApiKey}>Save</button>
                </div>
                {apiKeySaved && <div className="api-status connected">Key saved.</div>}
              </div>

              <div className="settings-section">
                <h3>Auto-Start</h3>
                <div className="settings-row">
                  <span className="settings-label">Launch on Windows startup</span>
                  <button
                    className={`toggle-btn ${autoStart ? "on" : "off"}`}
                    onClick={handleAutoStartToggle}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>

              <div className="settings-section">
                <h3>File Conflicts</h3>
                <p className="empty-msg" style={{ textAlign: "left", padding: "0 0 10px 0" }}>
                  What to do when a file with the same name already exists at the destination.
                </p>
                <div className="conflict-options">
                  {(["skip", "rename", "overwrite"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`conflict-btn ${conflictMode === mode ? "active" : ""}`}
                      onClick={() => handleConflictMode(mode)}
                    >
                      <span className="conflict-btn-label">
                        {mode === "skip" ? "Skip" : mode === "rename" ? "Rename" : "Overwrite"}
                      </span>
                      <span className="conflict-btn-desc">
                        {mode === "skip" ? "Don't move the file" : mode === "rename" ? "Add -1, -2, etc." : "Replace existing"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : isEditing ? (
            <div className="editor">
              <h2>{selectedRuleId ? "Edit Rule" : "New Rule"}</h2>

              <label>Rule Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Documents, Images..."
              />

              <label>Source Folder (watch this folder)</label>
              <div className="folder-pick">
                <input type="text" value={editSource} readOnly placeholder="Click Browse..." />
                <button onClick={() => pickFolder("source")}>Browse</button>
              </div>

              <label>Destination Folder (move files here)</label>
              <div className="folder-pick">
                <input type="text" value={editDest} readOnly placeholder="Click Browse..." />
                <button onClick={() => pickFolder("dest")}>Browse</button>
              </div>

              <label>Filename Contains (optional)</label>
              <input
                type="text"
                value={editNameContains}
                onChange={(e) => setEditNameContains(e.target.value)}
                placeholder='e.g. "invoice", "report", "2024"'
              />

              <label>AI Rename (images)</label>
              <div className="ai-rename-toggle">
                <button
                  className={`toggle-btn ${editAiRename ? "on" : "off"}`}
                  onClick={() => setEditAiRename(!editAiRename)}
                >
                  <span className="toggle-knob" />
                </button>
                <span className="ai-rename-desc">
                  {editAiRename
                    ? "AI will analyze images and give them descriptive names"
                    : "Files keep their original names"}
                </span>
              </div>

              <label>Quick Presets</label>
              <div className="presets">
                {Object.keys(EXTENSION_PRESETS).map((name) => (
                  <button key={name} className="preset-btn" onClick={() => selectPreset(name)}>
                    {name}
                  </button>
                ))}
              </div>

              <label>File Extensions</label>
              <div className="ext-chips">
                {editExtensions.map((ext) => (
                  <span key={ext} className="chip" onClick={() => toggleExtension(ext)}>
                    {ext} &#x2715;
                  </span>
                ))}
              </div>
              <div className="custom-ext">
                <input
                  type="text"
                  value={customExt}
                  onChange={(e) => setCustomExt(e.target.value)}
                  placeholder=".xyz"
                  onKeyDown={(e) => e.key === "Enter" && addCustomExt()}
                />
                <button onClick={addCustomExt}>Add</button>
              </div>

              <div className="editor-actions">
                <button className="btn-save" onClick={saveRule}>
                  {selectedRuleId ? "Update Rule" : "Create Rule"}
                </button>
                <button className="btn-cancel" onClick={cancelEdit}>Cancel</button>
                {selectedRuleId && (
                  <button className="btn-delete" onClick={() => deleteRule(selectedRuleId)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ) : selectedRule ? (
            <div className="rule-detail">
              <div className="detail-header">
                <h2>{selectedRule.name}</h2>
                <span className={`status-badge ${selectedRule.enabled ? "active" : "paused"}`}>
                  {selectedRule.enabled ? "Active" : "Paused"}
                </span>
              </div>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Source</span>
                  <span className="detail-value">{selectedRule.sourceFolder}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Destination</span>
                  <span className="detail-value">{selectedRule.destinationFolder}</span>
                </div>
                {selectedRule.nameContains && (
                  <div className="detail-item">
                    <span className="detail-label">Filename Contains</span>
                    <span className="detail-value">{selectedRule.nameContains}</span>
                  </div>
                )}
                <div className="detail-item">
                  <span className="detail-label">Extensions</span>
                  <span className="detail-value">{selectedRule.extensions.length > 0 ? selectedRule.extensions.join(", ") : "Any"}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">AI Rename</span>
                  <span className="detail-value">{selectedRule.aiRename ? "Enabled — images get descriptive names" : "Off"}</span>
                </div>
              </div>

              {/* Per-rule stat */}
              {stats.perRule[selectedRule.id] && (
                <div className="detail-item" style={{ marginBottom: 16 }}>
                  <span className="detail-label">Stats</span>
                  <span className="detail-value">
                    {stats.perRule[selectedRule.id].count} files moved ({formatBytes(stats.perRule[selectedRule.id].bytes)})
                  </span>
                </div>
              )}

              <div className="detail-actions">
                <button className="btn-edit" onClick={() => startEditRule(selectedRule)}>
                  Edit Rule
                </button>
                <button className="btn-delete" onClick={() => deleteRule(selectedRule.id)}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">&#x25C6;</div>
              <h2>The Portal</h2>
              <p>Create a rule to start organizing your files automatically.</p>
              <button className="btn-new-big" onClick={startNewRule}>
                + Create Your First Rule
              </button>
            </div>
          )}

          {/* Activity Log */}
          <div className="activity">
            <div className="activity-header">
              <h3>Activity Log</h3>
              <button className="btn-undo-small" onClick={handleUndo}>Undo</button>
            </div>
            <div className="activity-list">
              {activity.length === 0 && (
                <p className="empty-msg">No file movements yet. Activity will show here.</p>
              )}
              {activity.map((entry, i) => (
                <div key={i} className="activity-item">
                  <span className="activity-time">{entry.timestamp}</span>
                  <span className="activity-file" title={entry.renamedFrom ? `was: ${entry.renamedFrom}` : undefined}>
                    {entry.renamedFrom && <span className="ai-badge">AI</span>}
                    {entry.fileName}
                  </span>
                  <span className="activity-arrow">&rarr;</span>
                  <span className="activity-dest">{entry.to}</span>
                  <span className="activity-rule">{entry.ruleName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
