import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import {
  X, Github, Link2, Loader2, ArrowLeft, Download,
  FolderOpen, FileCode, Lock, Globe, ChevronRight, LogOut, AlertCircle, Check, Search
} from 'lucide-react';
import {
  getStoredToken, storeToken, clearToken, startOAuthPopup, fetchGitHubUser,
  getStoredUser, storeUser, listRepos, getRepoContents,
  fetchFileContent, fetchFromPublicUrl, parseGitHubUrl, fetchRepoTree,
  GitHubUser, GitHubRepo, GitHubContent, RepoTreeItem
} from '../services/githubService';
import { useMountTransition } from '../hooks/useMountTransition';
import { detectLanguageAI } from '../utils/detectLanguage';
import { ModalSurface } from './ModalSurface';

type Tab = 'url' | 'connect';
type BrowseView = 'auth' | 'repos' | 'files';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (fileName: string, content: string, language: string) => void;
  onImportRepo?: (repo: GitHubRepo, tree: RepoTreeItem[]) => void;
}

export const GitHubImportModal: React.FC<Props> = ({ isOpen, onClose, onImport, onImportRepo }) => {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('url');

  // URL tab state
  const [url, setUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [urlSuccess, setUrlSuccess] = useState('');

  // Connect tab state
  const [browseView, setBrowseView] = useState<BrowseView>('auth');

  const [user, setUser] = useState<GitHubUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Repo browser
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState('');
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  // File browser
  const [contents, setContents] = useState<GitHubContent[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [importingFile, setImportingFile] = useState<string | null>(null);
  const [importingRepo, setImportingRepo] = useState(false);

  // Init: check stored token
  useEffect(() => {
    if (isOpen) {
      const storedToken = getStoredToken();
      const storedUser = getStoredUser();
      if (storedToken && storedUser) {
        setUser(storedUser);
        setBrowseView('repos');
      } else {
        setBrowseView('auth');
      }
    }
  }, [isOpen]);

  // Load repos when entering repos view
  useEffect(() => {
    if (browseView === 'repos' && user) loadRepos();
  }, [browseView, user]);

  const loadRepos = async () => {
    const t = getStoredToken();
    if (!t) return;
    setReposLoading(true);
    try {
      const data = await listRepos(t, 1, 100);
      setRepos(data);
    } catch (e: any) {
      setAuthError(e.message);
    } finally {
      setReposLoading(false);
    }
  };

  const handleConnect = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const accessToken = await startOAuthPopup();
      const ghUser = await fetchGitHubUser(accessToken);
      storeToken(accessToken);
      storeUser(ghUser);
      setUser(ghUser);
      setBrowseView('repos');
    } catch (e: any) {
      setAuthError(e.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDisconnect = () => {
    clearToken();
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setContents([]);
    setCurrentPath('');
    setPathHistory([]);
    setBrowseView('auth');
  };

  const handleSelectRepo = async (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setCurrentPath('');
    setPathHistory([]);
    setBrowseView('files');
    await loadContents(repo.owner.login, repo.name, '');
  };

  const loadContents = async (owner: string, repo: string, path: string) => {
    const t = getStoredToken();
    if (!t) return;
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await getRepoContents(t, owner, repo, path);
      // Sort: dirs first, then files
      data.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setContents(data);
    } catch (e: any) {
      setFilesError(e.message);
    } finally {
      setFilesLoading(false);
    }
  };

  const handleNavigateDir = async (dirPath: string) => {
    if (!selectedRepo) return;
    setPathHistory(prev => [...prev, currentPath]);
    setCurrentPath(dirPath);
    await loadContents(selectedRepo.owner.login, selectedRepo.name, dirPath);
  };

  const handleGoBack = async () => {
    if (!selectedRepo) return;
    if (pathHistory.length === 0) {
      setBrowseView('repos');
      setSelectedRepo(null);
      return;
    }
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory(h => h.slice(0, -1));
    setCurrentPath(prev);
    await loadContents(selectedRepo.owner.login, selectedRepo.name, prev);
  };

  const handleImportFile = async (item: GitHubContent) => {
    if (!item.download_url) return;
    setImportingFile(item.path);
    try {
      const t = getStoredToken();
      const content = await fetchFileContent(item.download_url, t);
      const lang = await detectLanguageAI(item.name, content);
      onImport(item.name, content, lang);
      onClose();
    } catch (e: any) {
      setFilesError(e.message);
    } finally {
      setImportingFile(null);
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    if (!parseGitHubUrl(url.trim())) {
      setUrlError('Invalid GitHub URL. Use a github.com/…/blob/… or raw.githubusercontent.com/… link.');
      return;
    }
    setUrlLoading(true);
    setUrlError('');
    setUrlSuccess('');
    try {
      const { fileName, content } = await fetchFromPublicUrl(url.trim());
      const lang = await detectLanguageAI(fileName, content);
      setUrlSuccess(`Imported "${fileName}" successfully!`);
      onImport(fileName, content, lang);
      setTimeout(() => { onClose(); setUrl(''); setUrlSuccess(''); }, 800);
    } catch (e: any) {
      setUrlError(e.message);
    } finally {
      setUrlLoading(false);
    }
  };

  const filteredRepos = repoSearch
    ? repos.filter(r => r.name.toLowerCase().includes(repoSearch.toLowerCase()) || r.full_name.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos;

  const resetAndClose = useCallback(() => {
    setUrl(''); setUrlError(''); setUrlSuccess('');
    setAuthError(''); setFilesError('');
    onClose();
  }, [onClose]);

  const { hasRendered, isActive } = useMountTransition(isOpen, 300);

  if (!hasRendered) return null;

  // Style tokens
  const bg = isDark ? 'bg-[var(--ide-bg)]' : 'bg-white';
  const border = isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]';
  const text = isDark ? 'text-[var(--ide-text)]' : 'text-[var(--ide-text)]';
  const textMuted = isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]';
  const inputBg = isDark ? 'bg-[var(--ide-bg)] border-[var(--ide-border)] text-white placeholder:text-[var(--ide-muted)]' : 'bg-[var(--ide-panel)] border-[var(--ide-border)] text-[var(--ide-text)] placeholder:text-[var(--ide-muted)]';
  const hoverBg = isDark ? 'hover:bg-[var(--ide-hover)]' : 'hover:bg-[var(--ide-hover)]';

  return (
    <div className="ide-modal-layer fixed inset-0 z-50 flex items-center justify-center" onClick={resetAndClose}>
      <div className={`absolute inset-0 bg-black/60  transition-opacity duration-300 ease-out ${isActive ? 'opacity-100' : 'opacity-0'}`} />
      <ModalSurface title="Import from GitHub" onClose={resetAndClose} className="ide-modal-wide">
        <div className={`${bg} rounded flex flex-col overflow-hidden h-full relative`}
          onClick={e => e.stopPropagation()}>

        

        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${border} relative z-10`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[var(--ide-selected)] text-[var(--ide-accent)] flex items-center justify-center shadow-none">
              <Github size={18} className="text-white" />
            </div>
            <div>
              <h2 className={`text-lg font-semibold ${text}`}>Import from GitHub</h2>
              <p className={`text-xs ${textMuted}`}>Paste a link or browse your repos</p>
            </div>
          </div>
          <button aria-label="Close dialog" onClick={resetAndClose} className={`p-2 rounded ${hoverBg} transition-colors ${textMuted}`}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${border} px-6 relative z-10`}>
          {([['url', Link2, 'Paste URL'] as const, ['connect', Github, 'Connect GitHub'] as const]).map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key
                ? 'border-[var(--ide-border)] text-[var(--ide-accent)]'
                : `border-transparent ${textMuted} hover:text-[var(--ide-accent)]`}`}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">

          {/* ── Grid Container for URL and Auth to sync height ── */}
          {(tab === 'url' || (tab === 'connect' && browseView === 'auth')) && (
            <div className="grid">
              
              {/* ── URL Tab ────────────────────────────────── */}
              <div inert={tab !== 'url'} aria-hidden={tab !== 'url'} className={`col-start-1 row-start-1 p-6 space-y-4 transition-opacity duration-200 ${tab === 'url' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
                <p className={`text-sm ${textMuted}`}>
                  Paste a public GitHub file link to import it directly into the editor.
                </p>
                <div className="space-y-3">
                  <input
                    type="url"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setUrlError(''); setUrlSuccess(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleUrlImport()}
                    placeholder="https://github.com/owner/repo/blob/main/file.ts"
                    className={`w-full px-4 py-3 rounded border text-sm font-mono ${inputBg} focus:outline-none focus:ring-2 focus:ring-[var(--ide-accent)] transition-all`}
                    autoFocus={tab === 'url'}
                  />
                  {urlError && (
                    <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded px-3 py-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{urlError}</span>
                    </div>
                  )}
                  {urlSuccess && (
                    <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-500/10 rounded px-3 py-2">
                      <Check size={14} /><span>{urlSuccess}</span>
                    </div>
                  )}
                  <button onClick={handleUrlImport} disabled={urlLoading || !url.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--ide-selected)] text-[var(--ide-accent)] text-white rounded text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-none">
                    {urlLoading ? <Loader2 size={16} className="animate-spin" /> : <Github size={16} />}
                    {urlLoading ? 'Importing...' : 'Import File'}
                  </button>
                </div>
                <div className={`text-xs ${textMuted} space-y-1 pt-2`}>
                  <p className="font-medium">Supported URL formats:</p>
                  <code className={`block px-3 py-1.5 rounded ${isDark ? 'bg-[var(--ide-bg)]' : 'bg-[var(--ide-panel)]'} text-[11px]`}>
                    github.com/owner/repo/blob/branch/path/file.ext
                  </code>
                  <code className={`block px-3 py-1.5 rounded ${isDark ? 'bg-[var(--ide-bg)]' : 'bg-[var(--ide-panel)]'} text-[11px]`}>
                    raw.githubusercontent.com/owner/repo/branch/path/file.ext
                  </code>
                </div>
              </div>

              {/* ── Connect Tab (OAuth) ─────────────────── */}
              <div inert={tab !== 'connect'} aria-hidden={tab !== 'connect'} className={`col-start-1 row-start-1 p-6 space-y-5 transition-opacity duration-200 ${tab === 'connect' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded bg-[var(--ide-selected)] text-[var(--ide-accent)] flex items-center justify-center">
                    <Github size={32} className={isDark ? 'text-white' : 'text-[var(--ide-text)]'} />
                  </div>
                  <h3 className={`text-base font-semibold mb-1 ${text}`}>Connect your GitHub account</h3>
                  <p className={`text-sm ${textMuted}`}>
                    Sign in with GitHub to browse and import files from all your repositories — including private ones.
                  </p>
                </div>
                {/* Auth error toast — slides in above the button without growing the modal */}
                <div
                  className="overflow-hidden transition-all duration-300 ease-out"
                  style={{ maxHeight: authError ? '60px' : '0px', opacity: authError ? 1 : 0 }}
                >
                  <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded px-3 py-2.5 mb-1">
                    <AlertCircle size={14} className="shrink-0 animate-[pulse_1.5s_ease-in-out_3]" />
                    <span className="leading-snug">{authError}</span>
                  </div>
                </div>
                <button onClick={handleConnect} disabled={authLoading}
                  key={authError ? `err-${authError}` : 'idle'}
                  className={`w-full flex items-center justify-center gap-2.5 px-4 py-3.5 bg-[var(--ide-selected)] text-[var(--ide-accent)] text-white rounded text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-none border border-white/10 ${authError ? 'animate-shake' : ''}`}>
                  {authLoading ? (
                    <><Loader2 size={18} className="animate-spin" /> Authenticating…</>
                  ) : (
                    <><Github size={18} /> Sign in with GitHub</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Repos View ────────────────────────────── */}
          {tab === 'connect' && browseView === 'repos' && (
            <div className="flex flex-col h-full">
              {/* User bar */}
              {user && (
                <div className={`flex items-center justify-between px-6 py-3 border-b ${border}`}>
                  <div className="flex items-center gap-3">
                    <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full ring-2 ring-[var(--ide-accent)]" />
                    <span className={`text-sm font-medium ${text}`}>{user.name || user.login}</span>
                    <span className={`text-xs ${textMuted}`}>@{user.login}</span>
                  </div>
                  <button onClick={handleDisconnect} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                    <LogOut size={13} /> Disconnect
                  </button>
                </div>
              )}
              {/* Search */}
              <div className="px-6 py-3">
                <div className="relative">
                  <Search size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`} />
                  <input value={repoSearch} onChange={e => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className={`w-full pl-9 pr-4 py-2.5 rounded border text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-[var(--ide-accent)] transition-all`} />
                </div>
              </div>
              {/* List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4 space-y-1">
                {reposLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-[var(--ide-accent)]" />
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className={`text-center py-12 ${textMuted} text-sm`}>No repositories found.</div>
                ) : (
                  filteredRepos.map(repo => (
                    <button key={repo.id} onClick={() => handleSelectRepo(repo)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded transition-colors ${hoverBg} group`}>
                      <div className="flex items-center gap-3 truncate">
                        {repo.private ? <Lock size={14} className="text-amber-400 shrink-0" /> : <Globe size={14} className={`${textMuted} shrink-0`} />}
                        <div className="text-left truncate">
                          <div className={`text-sm font-medium ${text} truncate`}>{repo.name}</div>
                          {repo.description && <div className={`text-xs ${textMuted} truncate`}>{repo.description}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {repo.language && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${isDark ? 'bg-[var(--ide-bg)] text-[var(--ide-text)]' : 'bg-[var(--ide-panel)] text-[var(--ide-muted)]'}`}>
                            {repo.language}
                          </span>
                        )}
                        <ChevronRight size={14} className={`${textMuted} group-hover:text-[var(--ide-accent)] transition-colors`} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── Files View ────────────────────────────── */}
          {tab === 'connect' && browseView === 'files' && selectedRepo && (
            <div className="flex flex-col h-full">
              {/* Breadcrumb + Import Repo */}
              <div className={`flex items-center justify-between px-6 py-3 border-b ${border}`}>
                <div className="flex items-center gap-2">
                  <button onClick={handleGoBack} className={`p-1.5 rounded ${hoverBg} ${textMuted} hover:text-[var(--ide-accent)] transition-colors`}>
                    <ArrowLeft size={16} />
                  </button>
                  <div className="flex items-center gap-1 text-sm truncate">
                    <span className={`font-medium ${text}`}>{selectedRepo.name}</span>
                    {currentPath && (
                      <>
                        <span className={textMuted}>/</span>
                        <span className={`${textMuted} truncate`}>{currentPath}</span>
                      </>
                    )}
                  </div>
                </div>
                {onImportRepo && !currentPath && (
                  <button
                    onClick={async () => {
                      const t = getStoredToken();
                      if (!t || !selectedRepo) return;
                      setImportingRepo(true);
                      try {
                        const data = await fetchRepoTree(t, selectedRepo.owner.login, selectedRepo.name, selectedRepo.default_branch);
                        onImportRepo(selectedRepo, data.tree);
                        onClose();
                      } catch (e: any) {
                        setFilesError(e.message);
                      } finally {
                        setImportingRepo(false);
                      }
                    }}
                    disabled={importingRepo}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--ide-selected)] text-[var(--ide-accent)] text-white rounded text-xs font-medium transition-all disabled:opacity-50 shadow-none shrink-0"
                  >
                    {importingRepo ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    {importingRepo ? 'Importing…' : 'Import Repo'}
                  </button>
                )}
              </div>
              {/* File list */}
              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2 space-y-0.5">
                {filesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-[var(--ide-accent)]" />
                  </div>
                ) : filesError ? (
                  <div className="flex items-center gap-2 text-red-400 text-xs p-4">
                    <AlertCircle size={14} />{filesError}
                  </div>
                ) : (
                  contents.map(item => (
                    <button key={item.sha}
                      onClick={() => item.type === 'dir' ? handleNavigateDir(item.path) : handleImportFile(item)}
                      disabled={importingFile === item.path}
                      className={`w-full flex items-center justify-between px-4 py-2.5 rounded transition-colors ${hoverBg} group disabled:opacity-60`}>
                      <div className="flex items-center gap-3 truncate">
                        {item.type === 'dir'
                          ? <FolderOpen size={15} className="text-[var(--ide-accent)] shrink-0" />
                          : <FileCode size={15} className={`${textMuted} shrink-0`} />}
                        <span className={`text-sm ${text} truncate`}>{item.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {importingFile === item.path ? (
                          <Loader2 size={14} className="animate-spin text-[var(--ide-accent)]" />
                        ) : item.type === 'dir' ? (
                          <ChevronRight size={14} className={`${textMuted} group-hover:text-[var(--ide-accent)] transition-colors`} />
                        ) : (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--ide-selected)] text-[var(--ide-accent)]`}>
                            Import
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      </ModalSurface>
    </div>
  );
};
