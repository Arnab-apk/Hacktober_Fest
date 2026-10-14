import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { WorkspaceWelcome } from './WorkspaceWelcome';
import { ModernMonacoEditor } from './ModernMonacoEditor';
import { CollabMonacoEditor } from './CollabMonacoEditor';
import { FileExplorer } from './FileExplorer';
import { CollabBar } from './CollabBar';
import { ChatPanel } from './ChatPanel';
import { HarnessPanel } from './HarnessPanel';
import { AIWorkspacePanel } from './GemmaPanel';
import VoiceLobbyPanel from './VoiceLobbyPanel';
import { CodeRunner } from './CodeRunner';
import { TerminalPanel } from './TerminalPanel';
import { WorkspaceBar } from './WorkspaceBar';
import type { WorkspaceController } from '../hooks/useWorkspace';
import { CommandPalette, PaletteCommand } from './CommandPalette';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { StoredFile } from '../services/storageService';
import { hydrateFiles } from '../services/harnessService';
import { SharedFileInfo } from '../services/collabService';
import { VoiceManager } from '../services/voiceManager';
import { useTheme } from '../hooks/useTheme';
import { detectLanguage, detectLanguageAI } from '../utils/detectLanguage';
import {
  FileCode, Plus, Upload, Code2, FolderOpen, Sun, Moon,
  Github, Users, X, MessageSquare, Sparkles, Headphones, Terminal, Play, Search, PanelLeft, PanelBottom, Columns2, ChevronRight, Check, ArrowLeftRight,
} from 'lucide-react';
import {
  JavaScript, TypeScript, Python, CPlusPlus, C, Java, Go, RustDark, Ruby, PHP,
} from 'developer-icons';

/* ── Language icon map ─────────────────────────────────────────────── */
const langIconMap: Record<string, { icon: any }> = {
  JavaScript: { icon: JavaScript }, TypeScript: { icon: TypeScript },
  Python: { icon: Python }, 'C++': { icon: CPlusPlus }, C: { icon: C },
  Java: { icon: Java }, Go: { icon: Go }, Rust: { icon: RustDark },
  Ruby: { icon: Ruby }, PHP: { icon: PHP },
};

function LanguageIcon({ language, size = 16, className = '' }: { language: string; size?: number; className?: string }) {
  const entry = langIconMap[language];
  if (!entry) return <FileCode size={size} className={className} />;
  const Icon = entry.icon;
  return <div className={className} style={{ display: 'inline-flex', alignItems: 'center' }}><Icon size={size} /></div>;
}

/* ── Resize handle ─────────────────────────────────────────────────── */
function ResizeHandle({ vertical = false, hidden = false }: { vertical?: boolean; hidden?: boolean }) {
  return <Separator hidden={hidden} className={`ide-separator ${vertical ? 'ide-separator-horizontal' : ''}`} />;
}

function usePreference<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}

/* ── Types ─────────────────────────────────────────────────────────── */
interface CollabHook {
  status: import('../services/collabService').CollabStatus;
  roomId: string | null;
  isHost: boolean;
  displayName: string;
  color: string;
  members: import('../services/collabService').CollabMember[];
  pending: import('../services/collabService').PendingRequest[];
  sharedFiles: SharedFileInfo[];
  provider: import('../services/collabService').CollabProvider | null;
  toasts: import('../hooks/useCollabRoom').CollabToast[];
  chatMessages: import('../services/collabService').ChatMessage[];
  peerId: string;
  leaveRoom: () => void;
  approveJoin: (peerId: string) => void;
  rejectJoin: (peerId: string) => void;
  shareFile: (file: { id: string; name: string; language: string; content: string }) => void;
  unshareFile: (fileId: string) => void;
  dismissToast: (id: string) => void;
  sendChatMessage: (text: string) => void;
  voiceManager: VoiceManager;
}

interface EditorViewProps {
  workspace: WorkspaceController;
  files: StoredFile[];
  activeFileId: string | null;
  loadingFileId: string | null;
  onFileSelect: (id: string) => void;
  onFileLoad: (id: string) => void;
  onFileCreate: (name?: string, content?: string, language?: string) => void;
  onAgentFileCreate?: (name: string, content: string, language?: string) => void;
  onFileDelete: (id: string) => void;
  onFileUpload: (file: File) => void;
  onCodeChange: (id: string, newCode: string) => void;
  onLanguageChange: (id: string, language: string) => void;
  onOpenGitHub: () => void;
  onOpenGitHubPush: () => void;
  onOpenCollab: () => void;
  onRepoDelete?: (repoKey: string) => void;
  collab: CollabHook;
}

type MobilePane = 'editor' | 'runner' | 'gemini' | 'chat' | 'voice';

/* ── Component ─────────────────────────────────────────────────────── */
export const EditorView: React.FC<EditorViewProps> = ({
  workspace, files, activeFileId, loadingFileId, onFileSelect, onFileLoad, onFileCreate, onAgentFileCreate, onFileDelete, onFileUpload,
  onCodeChange, onLanguageChange, onOpenGitHub, onOpenGitHubPush, onOpenCollab, onRepoDelete, collab,
}) => {
  const { isDark, toggleTheme } = useTheme();

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const update = () => setIsMobile(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const [triggerNewFile, setTriggerNewFile] = useState(0);

  const activeFile = useMemo((): StoredFile | null => {
    if (!activeFileId) return null;
    const local = files.find(f => f.id === activeFileId);
    if (local) return local;
    const shared = collab.sharedFiles.find(f => f.id === activeFileId);
    if (shared) return { id: shared.id, name: shared.name, language: shared.language, content: '', contentHash: '', lastModified: Date.now() } as StoredFile;
    return null;
  }, [activeFileId, files, collab.sharedFiles]);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isGeminiOpen, setIsGeminiOpen] = usePreference('ide-agent-open', true);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = usePreference('ide-output-open', false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>('editor');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [cursorPosition, setCursorPosition] = useState({ ln: 1, col: 1 });
  const [selectionCount, setSelectionCount] = useState(0);
  const [fontSize] = useState(() => { const value = Number(localStorage.getItem('editor-font-size') || 14); return Number.isFinite(value) ? Math.max(10, Math.min(28, value)) : 14; });

  const drawerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastChatCountRef = useRef(0);
  const isInRoom = collab.status === 'connected' || collab.status === 'waiting-approval' || collab.status === 'connecting';

  useEffect(() => { setCursorPosition({ ln: 1, col: 1 }); setSelectionCount(0); }, [activeFileId]);

  useEffect(() => {
    if (!activeFile || activeFile.language) return;
    const syncLang = detectLanguage(activeFile.name, activeFile.content);
    if (syncLang) onLanguageChange(activeFile.id, syncLang);
    if (activeFile.content?.trim().length > 20) {
      detectLanguageAI(activeFile.name, activeFile.content).then(aiLang => {
        if (aiLang && aiLang !== syncLang) onLanguageChange(activeFile.id, aiLang);
      });
    }
  }, [activeFile?.id, activeFile?.language, activeFile?.name, activeFile?.content, onLanguageChange]);

  useEffect(() => { localStorage.setItem('editor-font-size', fontSize.toString()); }, [fontSize]);

  useEffect(() => {
    const currentCount = collab.chatMessages.length;

    if (isChatOpen) {
      setUnreadChatCount(0);
      lastChatCountRef.current = currentCount;
      return;
    }

    if (collab.status === 'connected' && currentCount > lastChatCountRef.current) {
      setUnreadChatCount((prev) => prev + (currentCount - lastChatCountRef.current));
    }

    lastChatCountRef.current = currentCount;
  }, [collab.chatMessages.length, collab.status, isChatOpen]);

  useEffect(() => {
    if (!collab.roomId) {
      setUnreadChatCount(0);
      lastChatCountRef.current = 0;
      setIsChatOpen(false);
      setIsVoiceOpen(false);
      setMobilePane('editor');
    }
  }, [collab.roomId]);

  useEffect(() => {
    if (!isInRoom && (mobilePane === 'chat' || mobilePane === 'voice')) {
      setMobilePane('editor');
    }
  }, [isInRoom, mobilePane]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sharedFileIds = useMemo(() => new Set(collab.sharedFiles.map(f => f.id)), [collab.sharedFiles]);

  const collabFileContents = useMemo(() => {
    const m = new Map<string, StoredFile>();
    for (const sf of collab.sharedFiles) {
      const local = files.find(f => f.id === sf.id);
      if (local) m.set(sf.id, local);
    }
    return m;
  }, [collab.sharedFiles, files]);

  const handleAddToCollab = useCallback(async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    try {
      const [loaded] = await hydrateFiles([file]);
      collab.shareFile({ id: loaded.id, name: loaded.path || loaded.name, language: loaded.language, content: loaded.content });
    } catch (error: any) { window.alert(error.message || 'Could not load the file for sharing.'); }
  }, [files, collab]);

  const handleRemoveFromCollab = useCallback((fileId: string) => { collab.unshareFile(fileId); }, [collab]);
  const handleSelectCollabFile = useCallback((fileId: string) => { onFileSelect(fileId); }, [onFileSelect]);
  const handleMobileFileSelect = useCallback((fileId: string) => {
    onFileSelect(fileId);
    setIsSidebarOpen(false);
    setMobilePane('editor');
  }, [onFileSelect]);


  const [explorerOpen, setExplorerOpen] = usePreference('ide-explorer-open', true);
  const [agentOnLeft, setAgentOnLeft] = usePreference('ide-agent-left', false);
  const [showMinimap, setShowMinimap] = usePreference('ide-minimap', false);
  const [projectToolsOpen, setProjectToolsOpen] = usePreference('ide-project-tools', false);
  const [shellOpen, setShellOpen] = usePreference('ide-terminal-open', false);
  const [focusMode, setFocusMode] = useState(false);
  const [picker, setPicker] = useState<'commands' | 'files' | null>(null);
  const [openIds, setOpenIds] = usePreference<string[]>('ide-open-tabs', []);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [runRequested, setRunRequested] = useState(false);
  const runHandled = useCallback(() => setRunRequested(false), []);
  const panelIds = [...(explorerOpen && !focusMode ? ['project'] : []), ...(agentOnLeft ? ['agent'] : []), 'center', ...(!agentOnLeft ? ['agent'] : []), ...(isInRoom && isChatOpen && !focusMode ? ['chat'] : []), ...(isInRoom && isVoiceOpen && !focusMode ? ['voice'] : [])];
  const layout = useDefaultLayout({ id: 'skiffy-workspace', panelIds });
  const agentRef = usePanelRef();
  const outputRef = usePanelRef();
  useEffect(() => { if (isGeminiOpen && !focusMode) agentRef.current?.expand(); else agentRef.current?.collapse(); }, [isGeminiOpen, focusMode, isMobile, agentOnLeft, agentRef]);
  useEffect(() => { if (isTerminalOpen && !focusMode) outputRef.current?.expand(); else outputRef.current?.collapse(); }, [isTerminalOpen, focusMode, isMobile, outputRef]);
  const outputLayout = useDefaultLayout({ id: 'skiffy-output', panelIds: ['editors', 'output'] });
  const workspaceFiles = useMemo(() => {
    const map = new Map(files.map(file => [file.id, file]));
    for (const shared of collab.sharedFiles) if (!map.has(shared.id)) map.set(shared.id, {
      id: shared.id, name: shared.name, language: shared.language, content: '', contentHash: '', lastModified: 0,
    });
    return [...map.values()];
  }, [files, collab.sharedFiles]);
  useEffect(() => { if (activeFileId) setOpenIds(ids => ids.includes(activeFileId) ? ids : [...ids, activeFileId]); }, [activeFileId]);
  const tabs = openIds.map(id => workspaceFiles.find(file => file.id === id)).filter((file): file is StoredFile => !!file);
  const visibleFile = activeFile && openIds.includes(activeFile.id) ? activeFile : null;
  const splitFile = workspaceFiles.find(file => file.id === splitId) || null;
  const selectFile = useCallback((id: string) => {
    setOpenIds(ids => ids.includes(id) ? ids : [...ids, id]);
    onFileSelect(id);
  }, [onFileSelect]);
  const closeTab = (id: string) => {
    const remaining = tabs.filter(file => file.id !== id);
    setOpenIds(ids => ids.filter(item => item !== id));
    if (activeFileId === id && remaining.length) onFileSelect(remaining[remaining.length - 1].id);
    if (splitId === id) setSplitId(null);
  };
  const toggleSplit = () => {
    if (splitId) { setSplitId(null); return; }
    const candidate = workspaceFiles.find(file => file.id !== activeFileId)?.id || activeFileId;
    setSplitId(candidate);
    if (candidate) onFileLoad(candidate);
  };
  const newFile = () => { setExplorerOpen(true); setIsSidebarOpen(isMobile); setTriggerNewFile(value => value + 1); };
  const closePicker = useCallback(() => setPicker(null), []);
  useEffect(() => {
    if (!isMobile || !isSidebarOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIsSidebarOpen(false); }
      if (event.key !== 'Tab') return;
      const elements = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])];
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); if (previous?.isConnected) previous.focus(); };
  }, [isMobile, isSidebarOpen]);
  const runActiveFile = () => {
    if (!visibleFile || visibleFile.contentLoaded === false || loadingFileId === visibleFile.id) return;
    setFocusMode(false);
    setIsTerminalOpen(true);
    setMobilePane('runner');
    setRunRequested(true);
  };
  useKeyboardShortcuts([
    { key: 'Enter', ctrl: true, action: runActiveFile, description: 'Run active file' },
    { key: 'n', ctrl: true, action: newFile, description: 'New file' },
    { key: 'd', ctrl: true, shift: true, action: toggleTheme, description: 'Toggle theme' },
    { key: 'g', ctrl: true, shift: true, action: onOpenGitHub, description: 'Import repository' },
    { key: 'u', ctrl: true, shift: true, action: onOpenGitHubPush, description: 'Push to GitHub' },
    { key: 'p', ctrl: true, shift: true, action: () => setPicker('commands'), description: 'Command palette' },
    { key: 'k', ctrl: true, action: () => setPicker('commands'), description: 'Command palette' },
    { key: 'p', ctrl: true, action: () => setPicker('files'), description: 'Quick open' },
    { key: 'b', ctrl: true, action: () => { setExplorerOpen(value => !value); setIsSidebarOpen(value => !value); }, description: 'Toggle project panel' },
    { key: String.fromCharCode(96), ctrl: true, action: () => setShellOpen(value => !value), description: 'Toggle terminal' },
    { key: 'a', ctrl: true, shift: true, action: () => setIsGeminiOpen(value => !value), description: 'Toggle agent' },
    { key: String.fromCharCode(92), ctrl: true, action: toggleSplit, description: 'Split editor' },
    { key: 'Enter', ctrl: true, shift: true, action: () => setFocusMode(value => !value), description: 'Focus mode' },
  ], picker === null);
  const commands: PaletteCommand[] = [
    { id: 'run-file', label: 'Run: Execute active file', icon: <Play size={15} />, action: runActiveFile, shortcut: 'Ctrl+Enter' },
    { id: 'new-file', label: 'File: New file', icon: <Plus size={15} />, action: newFile, shortcut: 'Ctrl+N' },
    { id: 'quick-open', label: 'File: Quick open', icon: <Search size={15} />, action: () => setPicker('files'), shortcut: 'Ctrl+P' },
    { id: 'project-tools', label: 'Project: Show saved projects and checkpoints', icon: <FolderOpen size={15} />, action: () => setProjectToolsOpen(value => !value) },
    { id: 'import', label: 'Project: Import from GitHub', icon: <Github size={15} />, action: onOpenGitHub },
    { id: 'upload', label: 'File: Upload from computer', icon: <Upload size={15} />, action: () => fileInputRef.current?.click() },
    { id: 'push', label: 'Git: Push to GitHub', icon: <Github size={15} />, action: onOpenGitHubPush, shortcut: 'Ctrl+Shift+U' },
    { id: 'collab', label: 'Collaboration: Create or join room', icon: <Users size={15} />, action: onOpenCollab },
    { id: 'explorer', label: 'Workspace: Toggle project panel', icon: <PanelLeft size={15} />, action: () => setExplorerOpen(value => !value), shortcut: 'Ctrl+B' },
    { id: 'agent', label: 'Workspace: Toggle agent panel', icon: <Sparkles size={15} />, action: () => setIsGeminiOpen(value => !value), shortcut: 'Ctrl+Shift+A' },
    { id: 'terminal', label: 'Workspace: Toggle terminal', icon: <Terminal size={15} />, action: () => setShellOpen(value => !value), shortcut: 'Ctrl+Backtick' },
    { id: 'output', label: 'Workspace: Toggle output dock', icon: <Terminal size={15} />, action: () => setIsTerminalOpen(value => !value) },
    { id: 'split', label: 'Editor: Toggle split pane', icon: <Columns2 size={15} />, action: toggleSplit, shortcut: 'Ctrl+Backslash' },
    { id: 'dock', label: 'Workspace: Move agent to ' + (agentOnLeft ? 'right' : 'left'), icon: <ArrowLeftRight size={15} />, action: () => setAgentOnLeft(value => !value) },
    { id: 'focus', label: 'Workspace: Toggle focus mode', icon: <Code2 size={15} />, action: () => setFocusMode(value => !value), shortcut: 'Ctrl+Shift+Enter' },
    { id: 'minimap', label: 'Editor: Toggle minimap', icon: <FileCode size={15} />, action: () => setShowMinimap(value => !value) },
    { id: 'theme', label: 'Theme: Switch to ' + (isDark ? 'light' : 'dark'), icon: isDark ? <Sun size={15} /> : <Moon size={15} />, action: toggleTheme, shortcut: 'Ctrl+Shift+D' },
  ];
  const fileCommands: PaletteCommand[] = workspaceFiles.map(file => ({
    id: file.id, label: file.name, detail: file.path || file.repoOrigin?.repo || 'Local workspace',
    keywords: [file.path || '', file.language], icon: <LanguageIcon language={file.language} size={15} />,
    action: () => { selectFile(file.id); setMobilePane('editor'); },
  }));
  const explorer = <aside className="ide-explorer">
    <div className="ide-panel-heading"><span>Project</span><div className="ide-inline-actions">
      <button className="ide-icon-button" aria-label="New file" title="New file" onClick={newFile}><Plus size={15} /></button>
      <button className="ide-icon-button" aria-label="Upload file" title="Upload file" onClick={() => fileInputRef.current?.click()}><Upload size={14} /></button>
      <button className="ide-icon-button" aria-label="Find file" title="Find file (Ctrl+P)" onClick={() => setPicker('files')}><Search size={14} /></button>
    </div></div>
    <div className="ide-project-name"><ChevronRight size={13} /><span>{activeFile?.repoOrigin?.repo || workspace.project?.name || 'Workspace'}</span><span className="ide-count">{workspaceFiles.length}</span></div>
    <div className="ide-file-tree custom-scrollbar">
      <FileExplorer files={files} activeFileId={activeFileId} loadingFileId={loadingFileId}
        onFileSelect={id => { selectFile(id); handleMobileFileSelect(id); }} onFileDelete={onFileDelete} onRepoDelete={onRepoDelete}
        onFileCreate={(name, content, language) => { onFileCreate(name, content, language); if (isMobile) setIsSidebarOpen(false); }} triggerNewFile={triggerNewFile}
        isInRoom={isInRoom} isHost={collab.isHost} sharedFiles={collab.sharedFiles}
        collabFileContents={collabFileContents} onAddToCollab={handleAddToCollab}
        onRemoveFromCollab={handleRemoveFromCollab} onSelectCollabFile={id => { selectFile(id); handleSelectCollabFile(id); }} />
    </div>
    <button className="ide-explorer-footer" onClick={onOpenGitHub}><Github size={14} /> Import repository</button>
  </aside>;
  const renderEditor = (file: StoredFile | null, secondary = false) => {
    if (!file) return <WorkspaceWelcome onNewFile={newFile} onImport={onOpenGitHub} onQuickOpen={() => setPicker('files')} onCommands={() => setPicker('commands')} files={workspaceFiles} onSelect={id => { selectFile(id); setMobilePane('editor'); }} />;
    if (loadingFileId === file.id || file.contentLoaded === false) return <div className="ide-welcome" role="status">Loading {file.name}…</div>;
    const common = { file, theme: isDark ? 'dark' as const : 'light' as const, fontSize, showMinimap,
      onChange: (code: string) => onCodeChange(file.id, code),
      onCursorChange: (ln: number, col: number) => { if (!secondary) setCursorPosition({ ln, col }); },
      onSelectionChange: (count: number) => { if (!secondary) setSelectionCount(count); } };
    return <div className="ide-editor-surface">
      {collab.status === 'waiting-approval' && <div className="ide-approval-overlay"><Users size={24} /><p>Waiting for host approval</p><button className="ide-text-button" onClick={collab.leaveRoom}>Cancel</button></div>}
      {sharedFileIds.has(file.id) && collab.provider && collab.status === 'connected'
        ? <CollabMonacoEditor {...common} provider={collab.provider} /> : <ModernMonacoEditor {...common} />}
    </div>;
  };
  const agent = <AIWorkspacePanel activeFile={activeFile}><HarnessPanel beginAgent={workspace.beginAgent} provider={collab.provider} sharedFiles={collab.sharedFiles} activeFile={activeFile} allFiles={files}
    onCodeChange={onCodeChange} onFileCreate={onFileCreate} onAgentFileCreate={onAgentFileCreate || onFileCreate} /></AIWorkspacePanel>;
  const output = visibleFile ? <CodeRunner code={visibleFile.content} language={visibleFile.language} fileName={visibleFile.name}
    triggerRun={runRequested} onRunHandled={runHandled} onClose={() => setIsTerminalOpen(false)} onLanguageChange={language => onLanguageChange(visibleFile.id, language)} />
    : <div className="ide-welcome"><Terminal size={24} /><p>Open a file to run code.</p></div>;
  return <div className="ide-shell">
    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
    <header className="ide-titlebar">
      <div className="ide-titlebar-left"><button className="ide-icon-button" aria-label="Toggle project panel" title="Toggle project panel (Ctrl+B)" aria-pressed={explorerOpen} onClick={() => { setExplorerOpen(value => !value); setIsSidebarOpen(value => !value); }}><PanelLeft size={16} /></button>
        <span className="ide-brand-symbol" aria-hidden="true"><Code2 size={16} /></span><span className="ide-brand">Skiffy</span><span className="ide-title-separator">/</span><button className="ide-workspace-label" aria-label="Toggle project tools" aria-expanded={projectToolsOpen} onClick={() => setProjectToolsOpen(value => !value)}>{activeFile?.repoOrigin?.repo || workspace.project?.name || 'Workspace'}</button>
      </div>
      <button className="ide-command-trigger" onClick={() => setPicker('commands')} aria-label="Open command palette"><Search size={13} /><span>Search commands…</span><kbd>Ctrl Shift P</kbd></button>
      <div className="ide-titlebar-right">
        <button className="ide-share-button ide-run-button" aria-label="Run active file" title="Run active file (Ctrl+Enter)" disabled={!visibleFile || visibleFile.contentLoaded === false || loadingFileId === visibleFile.id} onClick={runActiveFile}><Play size={14} /><span>Run</span></button>
        <button className="ide-icon-button" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className="ide-icon-button" aria-label="Push to GitHub" title="Push to GitHub" onClick={onOpenGitHubPush}><Github size={15} /></button>
        <button className="ide-share-button" onClick={onOpenCollab}><Users size={14} /><span>{isInRoom ? collab.members.length + ' online' : 'Collaborate'}</span></button>
      </div>
    </header>
    <div className="ide-workspace-tools" hidden={!projectToolsOpen}><WorkspaceBar workspace={workspace} room={collab.provider} /></div>
    {focusMode && <div className="ide-focus-notice">Focus mode<button onClick={() => setFocusMode(false)}>Exit <kbd>Ctrl Shift Enter</kbd></button></div>}
    <main className="ide-main">
      {!isMobile && <Group orientation="horizontal" className="ide-desktop" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
        {explorerOpen && !focusMode && <><Panel key="project" id="project" defaultSize="18%" minSize="170px" maxSize="35%">{explorer}</Panel><ResizeHandle /></>}
        {agentOnLeft && <React.Fragment key="agent-dock"><Panel key="agent" id="agent" aria-hidden={!isGeminiOpen || focusMode} inert={!isGeminiOpen || focusMode} panelRef={agentRef} collapsible defaultSize={isGeminiOpen ? "27%" : "0%"} minSize="250px" maxSize="40%">{agent}</Panel><ResizeHandle key="agent-divider" hidden={!isGeminiOpen || focusMode} /></React.Fragment>}
        <Panel key="center" id="center" minSize="25%" className="ide-center">
          <Group orientation="vertical" defaultLayout={outputLayout.defaultLayout} onLayoutChanged={outputLayout.onLayoutChanged}>
            <Panel id="editors" minSize="25%" className="ide-center">
              <div className="ide-tabs"><div className="ide-tab-scroll" role="tablist" aria-label="Open files" onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const current = tabs.findIndex(file => file.id === activeFileId);
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                if (tabs[index]) { selectFile(tabs[index].id); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus(); }
              }}>
                {tabs.map(file => <div key={file.id} className={'ide-tab ' + (file.id === activeFileId ? 'is-active' : '')}>
                  <button role="tab" tabIndex={file.id === activeFileId ? 0 : -1} aria-selected={file.id === activeFileId} onClick={() => selectFile(file.id)} title={file.path || file.name}><LanguageIcon language={file.language} size={14} /><span>{file.name}</span>{sharedFileIds.has(file.id) && <Users size={11} aria-label="Shared file" />}</button>
                  <button aria-label={'Close tab ' + file.name} className="ide-tab-close" onClick={() => closeTab(file.id)}><X size={12} /></button>
                </div>)}
              </div><div className="ide-inline-actions"><button className="ide-icon-button" aria-label="New file" onClick={newFile}><Plus size={15} /></button><button className="ide-icon-button" aria-label="Split editor" aria-pressed={!!splitFile} title="Split editor" onClick={toggleSplit} disabled={!activeFile}><Columns2 size={15} /></button></div></div>
              <Group orientation="horizontal" className="ide-editor-group">
                <Panel id="primary-editor" minSize="25%" className="ide-center">
                  {visibleFile && <div className="ide-breadcrumbs"><FolderOpen size={12} /><span>{visibleFile.repoOrigin?.repo || 'Workspace'}</span><ChevronRight size={12} /><span>{visibleFile.path || visibleFile.name}</span></div>}
                  {renderEditor(visibleFile)}
                </Panel>
                {splitFile && <><ResizeHandle /><Panel id="secondary-editor" minSize="25%" className="ide-center"><div className="ide-breadcrumbs"><Columns2 size={13} /><select aria-label="File in split pane" value={splitFile.id} onChange={e => { setSplitId(e.target.value); onFileLoad(e.target.value); }}>{workspaceFiles.map(file => <option key={file.id} value={file.id}>{file.path || file.name}</option>)}</select><button className="ide-icon-button" aria-label="Close split pane" onClick={() => setSplitId(null)}><X size={13} /></button></div>{renderEditor(splitFile, true)}</Panel></>}
              </Group>
            </Panel>
            <ResizeHandle vertical hidden={!isTerminalOpen || focusMode} /><Panel id="output" aria-hidden={!isTerminalOpen || focusMode} inert={!isTerminalOpen || focusMode} panelRef={outputRef} collapsible defaultSize={isTerminalOpen ? "30%" : "0%"} minSize="130px" maxSize="70%" className="ide-output">{output}</Panel>
          </Group>
        </Panel>
        {!agentOnLeft && <React.Fragment key="agent-dock"><ResizeHandle key="agent-divider" hidden={!isGeminiOpen || focusMode} /><Panel key="agent" id="agent" aria-hidden={!isGeminiOpen || focusMode} inert={!isGeminiOpen || focusMode} panelRef={agentRef} collapsible defaultSize={isGeminiOpen ? "27%" : "0%"} minSize="250px" maxSize="40%">{agent}</Panel></React.Fragment>}
        {isInRoom && isChatOpen && !focusMode && <><ResizeHandle /><Panel id="chat" defaultSize="22%" minSize="200px"><ChatPanel isOpen messages={collab.chatMessages} selfPeerId={collab.peerId} onSendMessage={collab.sendChatMessage} canSend={collab.status === 'connected'} onClose={() => setIsChatOpen(false)} /></Panel></>}
        {isInRoom && isVoiceOpen && !focusMode && <><ResizeHandle /><Panel id="voice" defaultSize="20%" minSize="200px"><VoiceLobbyPanel isOpen members={collab.members} selfPeerId={collab.peerId} provider={collab.provider} canUseVoice={collab.status === 'connected'} onClose={() => setIsVoiceOpen(false)} voiceManager={collab.voiceManager} /></Panel></>}
      </Group>}
      {isMobile && <div className="ide-mobile" inert={isSidebarOpen}><nav className="ide-mobile-nav" aria-label="Workspace panels">
        {([{ id: 'editor', label: 'Editor', icon: <Code2 size={15} /> }, { id: 'runner', label: 'Output', icon: <Terminal size={15} /> }, { id: 'gemini', label: 'Agent', icon: <Sparkles size={15} /> }, ...(isInRoom ? [{ id: 'chat', label: 'Chat', icon: <MessageSquare size={15} /> }, { id: 'voice', label: 'Voice', icon: <Headphones size={15} /> }] : [])] as Array<{ id: MobilePane; label: string; icon: React.ReactNode }>).map(tab => <button key={tab.id} aria-pressed={mobilePane === tab.id} className={mobilePane === tab.id ? 'is-active' : ''} onClick={() => setMobilePane(tab.id)}>{tab.icon}{tab.label}</button>)}
      </nav><div className="ide-mobile-content" key={mobilePane}>{mobilePane === 'editor' ? renderEditor(visibleFile) : mobilePane === 'runner' ? output : mobilePane === 'gemini' ? agent : mobilePane === 'chat' ? <ChatPanel isOpen messages={collab.chatMessages} selfPeerId={collab.peerId} onSendMessage={collab.sendChatMessage} canSend={collab.status === 'connected'} onClose={() => setMobilePane('editor')} /> : <VoiceLobbyPanel isOpen members={collab.members} selfPeerId={collab.peerId} provider={collab.provider} canUseVoice={collab.status === 'connected'} onClose={() => setMobilePane('editor')} voiceManager={collab.voiceManager} />}</div></div>}
      {isMobile && isSidebarOpen && <div className="ide-mobile-drawer"><button className="ide-drawer-backdrop" aria-label="Close project panel" onClick={() => setIsSidebarOpen(false)} /><div ref={drawerRef} className="ide-drawer-content" role="dialog" aria-modal="true" aria-label="Project files"><button className="ide-icon-button ide-drawer-close" aria-label="Close project panel" onClick={() => setIsSidebarOpen(false)}><X size={16} /></button>{explorer}</div></div>}
    </main>
    <div className="ide-real-terminal"><TerminalPanel workspace={workspace} room={collab.provider} visible={shellOpen && !focusMode} onHide={() => setShellOpen(false)} /></div>
    <footer className="ide-statusbar"><div className="ide-status-left"><span className="ide-save-state"><Check size={12} /> {workspace.project ? workspace.status : 'Saved locally'}</span><span>{workspaceFiles.length} files</span>{visibleFile && <span>{visibleFile.language || 'Plain text'}</span>}</div><div className="ide-status-right">
      {visibleFile && <span className="ide-cursor-position">Ln {cursorPosition.ln}, Col {cursorPosition.col}{selectionCount > 0 ? ' (' + selectionCount + ' selected)' : ''}</span>}
      <button aria-label="Toggle output dock" aria-pressed={isTerminalOpen} title="Code output" onClick={() => setIsTerminalOpen(value => !value)}><PanelBottom size={14} /><span>Output</span></button>
      <button aria-label="Toggle terminal" aria-pressed={shellOpen} title="Terminal (Ctrl+Backtick)" onClick={() => setShellOpen(value => !value)}><Terminal size={14} /><span>Terminal</span></button>
      <button aria-label="Toggle agent panel" aria-pressed={isGeminiOpen} title="Agent (Ctrl+Shift+A)" onClick={() => setIsGeminiOpen(value => !value)}><Sparkles size={14} /><span>Agent</span></button>
      {isInRoom && <><button aria-label="Toggle chat" aria-pressed={isChatOpen} onClick={() => setIsChatOpen(value => !value)}><MessageSquare size={14} />{unreadChatCount > 0 && <span>{unreadChatCount}</span>}</button><button aria-label="Toggle voice" aria-pressed={isVoiceOpen} onClick={() => setIsVoiceOpen(value => !value)}><Headphones size={14} /></button></>}
    </div></footer>
    {isInRoom && collab.roomId && <CollabBar roomId={collab.roomId} status={collab.status} isHost={collab.isHost} members={collab.members} pending={collab.pending} toasts={collab.toasts} onApprove={collab.approveJoin} onReject={collab.rejectJoin} onLeave={collab.leaveRoom} onDismissToast={collab.dismissToast} />}
    <div className="ide-toasts" aria-live="polite">{collab.toasts.map(toast => <div key={toast.id} className={'ide-toast ' + (toast.type === 'error' ? 'is-error' : '')}><span>{toast.fileName && <strong>{toast.fileName}: </strong>}{toast.message}</span><button className="ide-icon-button" aria-label="Dismiss notification" onClick={() => collab.dismissToast(toast.id)}><X size={13} /></button></div>)}</div>
    <CommandPalette isOpen={picker !== null} onClose={closePicker} commands={picker === 'files' ? fileCommands : commands} title={picker === 'files' ? 'Open file' : 'Command palette'} placeholder={picker === 'files' ? 'Search files by name or path…' : 'Type a command…'} />
  </div>;
};
