// Editor storage service.
// Handles localStorage persistence for files, active file, and theme.

import { FileNode, Theme } from '../types';

const KEYS = {
  FILES: 'codecollab-v2-files',
  ACTIVE_FILE: 'codecollab-v2-active-file',
  THEME: 'codecollab-v2-theme',
} as const;

// ─── File Storage ──────────────────────────────────────────────────────

export interface StoredFile extends FileNode {
  contentHash: string;
  lastModified: number;
  /** Full path within repo, e.g. "src/App.tsx". Empty for standalone snippets. */
  path?: string;
  /** Repo origin info for files imported via full-repo import. */
  repoOrigin?: {
    owner: string;
    repo: string;
    branch: string;
  };
  /** Whether content has been fetched (for lazy-loaded repo files). */
  contentLoaded?: boolean;
}

/** Simple djb2-style hash for content comparison */
export function computeContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Files ─────────────────────────────────────────────────────────────

export function getStoredFiles(): StoredFile[] {
  return readJSON<StoredFile[]>(KEYS.FILES, []);
}

export function saveFiles(files: StoredFile[]): void {
  writeJSON(KEYS.FILES, files);
}

// ─── Active File ───────────────────────────────────────────────────────

export function getActiveFileId(): string | null {
  return localStorage.getItem(KEYS.ACTIVE_FILE);
}

export function setActiveFileId(fileId: string): void {
  localStorage.setItem(KEYS.ACTIVE_FILE, fileId);
}

// ─── Theme ─────────────────────────────────────────────────────────────

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(KEYS.THEME);
  if (stored === 'light' || stored === 'dark') return stored;
  // System preference
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(KEYS.THEME, theme);
}

// ─── Clear All ─────────────────────────────────────────────────────────

export function clearAllStorage(): void {
  Object.values(KEYS).forEach(k => {
    localStorage.removeItem(k);
  });
}
