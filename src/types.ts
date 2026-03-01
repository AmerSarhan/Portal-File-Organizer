export interface Rule {
  id: string;
  name: string;
  sourceFolder: string;
  extensions: string[];
  nameContains: string;
  destinationFolder: string;
  aiRename: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface ActivityEntry {
  timestamp: string;
  fileName: string;
  from: string;
  to: string;
  ruleName: string;
  fileSize?: number;
  renamedFrom?: string;
}

export interface AiRuleResult {
  rule?: Rule;
  error?: string;
}

export interface Stats {
  totalMoved: number;
  totalBytes: number;
  perRule: Record<string, { name: string; count: number; bytes: number }>;
  daily: Record<string, { count: number; bytes: number }>;
}

export interface AppSettings {
  conflictMode: "skip" | "rename" | "overwrite";
}

declare global {
  interface Window {
    api: {
      getRules: () => Promise<Rule[]>;
      addRule: (rule: Rule) => Promise<Rule[]>;
      updateRule: (rule: Rule) => Promise<Rule[]>;
      deleteRule: (id: string) => Promise<Rule[]>;
      toggleRule: (id: string) => Promise<Rule[]>;
      getActivity: () => Promise<ActivityEntry[]>;
      selectFolder: () => Promise<string | null>;
      onFileMoved: (callback: (entry: ActivityEntry) => void) => void;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      getApiKey: () => Promise<string>;
      saveApiKey: (key: string) => Promise<boolean>;
      aiCreateRule: (prompt: string) => Promise<AiRuleResult>;
      getStats: () => Promise<Stats>;
      undoLastMove: () => Promise<{ success?: boolean; fileName?: string; error?: string }>;
      organizeNow: () => Promise<{ count: number }>;
      getAutoStart: () => Promise<boolean>;
      setAutoStart: (enabled: boolean) => Promise<boolean>;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    };
  }
}
