import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../hooks/useTheme';
import {
  X, Github, Upload, Loader2, CheckCircle2, AlertCircle,
  ExternalLink, Key, GitBranch, MessageSquare, Files, FileCode, Users, Trash2
} from 'lucide-react';
import { StoredFile } from '../services/storageService';
import {
  pushFilesToGitHub, PushResult, getStoredUser, GitHubUser
} from '../services/githubService';
import { soundEffects } from '../utils/soundEffects';
import { ModalSurface } from './ModalSurface';
import { CollabProvider } from '../services/collabService';
import { hydrateFiles } from '../services/harnessService';

// Separate storage key for push PAT — never shares with OAuth read token
const PUSH_PAT_KEY = 'skiffy-push-pat';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  files: StoredFile[];
  activeFile: StoredFile | null;
  isInRoom: boolean;
  provider?: CollabProvider | null;
  sharedFiles?: Array<{ id: string; name: string; language: string }>;
}

type Scope = 'all' | 'collab' | 'active';

export const GitHubPushModal: React.FC<Props> = ({
  isOpen,
  onClose,
  files,
  activeFile,
  isInRoom,
  sharedFiles = [],
  provider,
}) => {
  const { isDark } = useTheme();

  // Destination state
  const defaultRepo = useMemo(() => {
    // If active file or any file has repo origin, use that
    const repoFile = files.find(f => f.repoOrigin);
    if (repoFile?.repoOrigin) {
      return `${repoFile.repoOrigin.owner}/${repoFile.repoOrigin.repo}`;
    }
    return '';
  }, [files]);

  const [repoString, setRepoString] = useState(defaultRepo);
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('feat: collaborative updates from Skiffy');
  const [scope, setScope] = useState<Scope>(isInRoom && sharedFiles.length > 0 ? 'collab' : 'all');

  // Auth state — uses a dedicated PAT key, never the OAuth read token
  const [token, setToken] = useState(() => localStorage.getItem(PUSH_PAT_KEY) || '');
  const [saveTokenLocally, setSaveTokenLocally] = useState(false);
  const [storedUser, setStoredUser] = useState<GitHubUser | null>(getStoredUser);
  const [tokenOk, setTokenOk] = useState<boolean | null>(null); // null = not validated

  // Execution state
  const [isPushing, setIsPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRepoString(defaultRepo);
      setScope(isInRoom && sharedFiles.length > 0 ? 'collab' : 'all');
      setBranch(activeFile?.repoOrigin?.branch || files.find(f => f.repoOrigin)?.repoOrigin?.branch || 'main');
      setError(null);
      setPushResult(null);
      setPushStatus('');
      setTokenOk(null);
      // Load only the dedicated push PAT, not the OAuth read token
      const savedPat = localStorage.getItem(PUSH_PAT_KEY) || '';
      setToken(savedPat);
      setStoredUser(getStoredUser());
    }
  }, [isOpen, defaultRepo]);

  // Determine files to push based on selected scope
  const filesToPush = useMemo(() => {
    if (scope === 'active') {
      return activeFile ? [{ path: activeFile.path || activeFile.name, content: activeFile.content }] : [];
    }
    if (scope === 'collab' && isInRoom) {
      const sharedIds = new Set(sharedFiles.map(s => s.id));
      const filtered = files.filter(f => sharedIds.has(f.id));
      return filtered.map(f => ({
        path: f.path || f.name,
        content: f.content,
      }));
    }
    // Scope: 'all'
    return files.map(f => ({
      path: f.path || f.name,
      content: f.content,
    }));
  }, [scope, activeFile, isInRoom, sharedFiles, files]);

  if (!isOpen) return null;

  const handlePush = async () => {
    setError(null);
    setPushResult(null);

    const trimmedRepo = repoString.trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmedRepo)) {
      setError("Please specify the repository as 'owner/repo'.");
      return;
    }

    const [owner, repo] = trimmedRepo.split('/');
    if (!owner || !repo) {
      setError("Invalid repository format. Must be 'owner/repo'.");
      return;
    }

    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError('Please provide a GitHub Personal Access Token (PAT) with repo scope.');
      return;
    }

    if (filesToPush.length === 0) {
      setError('No files available to push.');
      return;
    }

    if (saveTokenLocally) {
      // Save under dedicated push-PAT key only
      localStorage.setItem(PUSH_PAT_KEY, trimmedToken);
    }

    setIsPushing(true);
    setPushStatus('Preparing Git tree and commit...');

    try {
      if (provider?.agentOwner) throw new Error('Wait for the harness to finish before pushing.');
      const sharedIds = new Set(sharedFiles.map(f => f.id));
      const selected = scope === 'active' ? (activeFile ? [activeFile] : []) : scope === 'collab' ? files.filter(f => sharedIds.has(f.id)) : files;
      if (provider && isInRoom) await Promise.all(selected.filter(f => sharedIds.has(f.id)).map(f => provider.openFileConnection(f.id).waitForSync()));
      const snapshot = await hydrateFiles(selected.map(f => provider && isInRoom && sharedIds.has(f.id)
        ? { ...f, content: provider.openFileConnection(f.id).doc.getText('monaco').toString(), contentLoaded: true } : f));
      setPushStatus(`Pushing ${filesToPush.length} file(s) to ${owner}/${repo} (${branch})...`);
      const res = await pushFilesToGitHub({
        owner,
        repo,
        branch: branch.trim() || 'main',
        message: commitMessage.trim() || 'feat: updates from Skiffy',
        files: snapshot.map(f => ({ path: f.path || f.name, content: f.content })),
        token: trimmedToken,
      });

      setPushResult(res);
      soundEffects.success();
    } catch (err: any) {
      setError(err.message || 'Failed to push to GitHub');
      soundEffects.error?.();
    } finally {
      setIsPushing(false);
      setPushStatus('');
    }
  };

  return (
    <div className="ide-modal-layer fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60  animate-fade-in" onClick={onClose}>
      <ModalSurface title="Push to GitHub" onClose={onClose} className="ide-modal-wide">
        <div
          className={`relative w-full rounded shadow-none overflow-hidden flex flex-col ${
            isDark ? 'bg-[var(--ide-bg)] text-[var(--ide-text)]' : 'bg-white text-[var(--ide-text)]'
          }`}
          onClick={e => e.stopPropagation()}
        >

        {/* Modal Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded ${isDark ? 'bg-[var(--ide-selected)] text-[var(--ide-accent)]' : 'bg-[var(--ide-selected)] text-[var(--ide-accent)]'}`}>
              <Github size={20} />
            </div>
            <div>
              <h2 className="text-base font-medium flex items-center gap-2">
                Push to GitHub
                {isInRoom && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <Users size={10} /> Collab Session
                  </span>
                )}
              </h2>
              <p className={`text-xs ${isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]'}`}>
                Commit and push your collaborative code directly to your GitHub repository
              </p>
            </div>
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            className={`p-1.5 rounded transition-colors ${
              isDark ? 'hover:bg-[var(--ide-hover)] text-[var(--ide-muted)] hover:text-[var(--ide-text)]' : 'hover:bg-[var(--ide-hover)] text-[var(--ide-muted)] hover:text-[var(--ide-text)]'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* Success Banner */}
          {pushResult && (
            <div className={`p-4 rounded border flex flex-col gap-2 ${
              isDark ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800'
            }`}>
              <div className="flex items-center gap-2 font-medium text-sm">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <span>Successfully pushed {pushResult.filesPushed} file(s)!</span>
              </div>
              <p className="text-xs opacity-90">
                Commit SHA: <code className="font-mono bg-black/20 px-1 py-0.5 rounded">{pushResult.commitSha.slice(0, 7)}</code>
              </p>
              <a
                href={pushResult.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium underline hover:opacity-80 mt-1"
              >
                View commit on GitHub <ExternalLink size={12} />
              </a>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className={`p-3.5 rounded border flex items-start gap-2.5 text-xs ${
              isDark ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600'
            }`}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Destination Repo & Branch */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                <Github size={13} /> Repository (owner/repo)
              </label>
              <input
                type="text"
                value={repoString}
                onChange={e => setRepoString(e.target.value)}
                placeholder="devspideyy/skippy_paradox"
                className={`w-full px-3 py-2 text-xs font-mono rounded border outline-none transition-colors ${
                  isDark
                    ? 'bg-[var(--ide-bg)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                    : 'bg-[var(--ide-panel)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                }`}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                <GitBranch size={13} /> Branch
              </label>
              <input
                type="text"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
                className={`w-full px-3 py-2 text-xs font-mono rounded border outline-none transition-colors ${
                  isDark
                    ? 'bg-[var(--ide-bg)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                    : 'bg-[var(--ide-panel)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                }`}
              />
            </div>
          </div>

          {/* Commit Message */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              <MessageSquare size={13} /> Commit Message
            </label>
            <input
              type="text"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              placeholder="feat: collaborative updates from Skiffy"
              className={`w-full px-3 py-2 text-xs rounded border outline-none transition-colors ${
                isDark
                  ? 'bg-[var(--ide-bg)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                  : 'bg-[var(--ide-panel)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
              }`}
            />
          </div>

          {/* Scope Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              <Files size={13} /> Files to Include ({filesToPush.length})
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`flex flex-col items-center justify-center p-2.5 rounded border text-xs font-medium transition-all ${
                  scope === 'all'
                    ? (isDark ? 'bg-[var(--ide-selected)] border-[var(--ide-border)] text-[var(--ide-accent)]' : 'bg-[var(--ide-selected)] border-[var(--ide-border)] text-[var(--ide-accent)]')
                    : (isDark ? 'border-[var(--ide-border)] hover:bg-[var(--ide-hover)] text-[var(--ide-muted)]' : 'border-[var(--ide-border)] hover:bg-[var(--ide-hover)] text-[var(--ide-muted)]')
                }`}
              >
                <span>All Workspace</span>
                <span className="text-[10px] opacity-75">{files.length} files</span>
              </button>

              {isInRoom && (
                <button
                  type="button"
                  onClick={() => setScope('collab')}
                  className={`flex flex-col items-center justify-center p-2.5 rounded border text-xs font-medium transition-all ${
                    scope === 'collab'
                      ? (isDark ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-emerald-50 border-emerald-400 text-emerald-700')
                      : (isDark ? 'border-[var(--ide-border)] hover:bg-[var(--ide-hover)] text-[var(--ide-muted)]' : 'border-[var(--ide-border)] hover:bg-[var(--ide-hover)] text-[var(--ide-muted)]')
                  }`}
                >
                  <span>Collab Shared</span>
                  <span className="text-[10px] opacity-75">{sharedFiles.length} files</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setScope('active')}
                disabled={!activeFile}
                className={`flex flex-col items-center justify-center p-2.5 rounded border text-xs font-medium transition-all disabled:opacity-40 ${
                  scope === 'active'
                    ? (isDark ? 'bg-[var(--ide-selected)] border-[var(--ide-border)] text-[var(--ide-accent)]' : 'bg-[var(--ide-selected)] border-[var(--ide-border)] text-[var(--ide-accent)]')
                    : (isDark ? 'border-[var(--ide-border)] hover:bg-[var(--ide-hover)] text-[var(--ide-muted)]' : 'border-[var(--ide-border)] hover:bg-[var(--ide-hover)] text-[var(--ide-muted)]')
                }`}
              >
                <span>Active File</span>
                <span className="text-[10px] opacity-75 truncate max-w-[120px]">{activeFile ? activeFile.name : 'None'}</span>
              </button>
            </div>

            {/* File List Chips */}
            <div className={`flex flex-wrap gap-1.5 p-2 rounded border max-h-24 overflow-y-auto custom-scrollbar ${
              isDark ? 'bg-[var(--ide-bg)] border-[var(--ide-border)]' : 'bg-[var(--ide-panel)] border-[var(--ide-border)]'
            }`}>
              {filesToPush.map((f, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono ${
                    isDark ? 'bg-[var(--ide-bg)] text-[var(--ide-text)]' : 'bg-white text-[var(--ide-text)] border border-[var(--ide-border)]'
                  }`}
                >
                  <FileCode size={11} className="text-[var(--ide-accent)] shrink-0" />
                  <span className="truncate max-w-[140px]">{f.path}</span>
                </span>
              ))}
            </div>
          </div>

          {/* GitHub Auth Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                <Key size={13} /> GitHub Personal Access Token
              </label>
              {storedUser && (
                <span className="text-[11px] text-[var(--ide-accent)] font-medium">
                  Logged in as @{storedUser.login}
                </span>
              )}
            </div>

            {/* Token hint banner */}
            <div className={`text-[11px] px-3 py-2 rounded flex items-start gap-2 ${
              isDark ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300' : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                Requires a <strong>Personal Access Token</strong> (PAT) with <code className="font-mono">repo</code> scope.
                {' '}This is <em>different</em> from your GitHub login — it won't pick up the Import OAuth token automatically.
              </span>
            </div>

            <div className="relative">
              <input
                type="password"
                value={token}
                onChange={e => { setToken(e.target.value); setTokenOk(null); setError(null); }}
                placeholder="ghp_... or github_pat_..."
                className={`w-full px-3 py-2 pr-8 text-xs font-mono rounded border outline-none transition-colors ${
                  isDark
                    ? 'bg-[var(--ide-bg)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                    : 'bg-[var(--ide-panel)] border-[var(--ide-border)] focus:border-[var(--ide-border)] text-[var(--ide-text)]'
                } ${tokenOk === false ? (isDark ? 'border-red-500' : 'border-red-400') : ''}`}
              />
              {token && (
                <button
                  type="button"
                  onClick={() => { setToken(''); setTokenOk(null); localStorage.removeItem(PUSH_PAT_KEY); }}
                  title="Clear saved token"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ide-muted)] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-[11px] cursor-pointer opacity-80 hover:opacity-100">
                <input
                  type="checkbox"
                  checked={saveTokenLocally}
                  onChange={e => setSaveTokenLocally(e.target.checked)}
                  className="rounded border-[var(--ide-border)] text-[var(--ide-accent)] focus:ring-[var(--ide-accent)]"
                />
                Remember token on this device
              </label>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[var(--ide-accent)] hover:underline flex items-center gap-1"
              >
                Generate Token <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${isDark ? 'border-[var(--ide-border)] bg-[var(--ide-bg)]' : 'border-[var(--ide-border)] bg-[var(--ide-panel)]'}`}>
          <div className="text-xs text-[var(--ide-muted)] truncate max-w-[240px]">
            {pushStatus || (isPushing ? 'Working...' : `Ready to push ${filesToPush.length} files`)}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={isPushing}
              className={`px-4 py-2 rounded text-xs font-semibold transition-colors ${
                isDark ? 'bg-[var(--ide-bg)] hover:bg-[var(--ide-hover)] text-[var(--ide-text)]' : 'bg-[var(--ide-panel)] hover:bg-[var(--ide-hover)] text-[var(--ide-text)]'
              }`}
            >
              Close
            </button>
            <button
              onClick={handlePush}
              disabled={isPushing || filesToPush.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded text-xs font-medium text-white bg-[var(--ide-selected)] text-[var(--ide-accent)] shadow-none transition-all  disabled:opacity-50 disabled:pointer-events-none"
            >
              {isPushing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Pushing...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Commit & Push
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalSurface>
  </div>
);
};
