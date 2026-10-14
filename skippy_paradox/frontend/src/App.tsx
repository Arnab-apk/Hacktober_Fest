import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EditorView } from './components/EditorView';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { soundEffects } from './utils/soundEffects';
import {
  getStoredFiles, saveFiles, getActiveFileId, setActiveFileId as saveActiveFileId,
  computeContentHash, StoredFile
} from './services/storageService';
import { detectLanguage, detectLanguageAI } from './utils/detectLanguage';
import { fetchRawContent, getStoredToken, GitHubRepo, RepoTreeItem } from './services/githubService';
import { GitHubImportModal } from './components/GitHubImportModal';
import { GitHubPushModal } from './components/GitHubPushModal';
import { CollabRoomModal } from './components/CollabRoomModal';
import { useCollabRoom } from './hooks/useCollabRoom';
import { useWorkspace } from './hooks/useWorkspace';




// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let hasRefreshed = false;
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        // Pull latest SW on page load.
        registration.update().catch(() => {});

        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (hasRefreshed) return;
          hasRefreshed = true;
          window.location.reload();
        });
      })
      .catch(() => {
        // Service worker registration failed, app will work without offline support
      });
  });
}

export const App: React.FC = () => {
  const themeCtx = useThemeProvider();

  const [files, setFiles] = useState<StoredFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [showGitHubPushModal, setShowGitHubPushModal] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);

  // ─── Collab Room ─────────────────────────────────────────────────────
  const collab = useCollabRoom();
  const workspace = useWorkspace(files, setFiles, activeFileId, setActiveFileId, collab.provider, isInitialized);
  const autoSharedRef = useRef(false);

  // ─── File Handlers ───────────────────────────────────────────────────
  const handleFileCreate = useCallback((name?: string, content: string = '', language?: string) => {
    if (workspace.project && collab.status === 'connected' && !collab.isHost) { workspace.setError('Only the room host can add project files. Ask Skippy to create shared files, or ask the host to add them.'); return; }
    const fileName = name?.trim() || `Snippet-${files.length + 1}`;
    const detectedLang = language || detectLanguage(fileName, content) || '';
    const newId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newFile: StoredFile = {
      id: newId,
      name: fileName,
      content,
      language: detectedLang,
      contentHash: computeContentHash(content),
      lastModified: Date.now(),
      contentLoaded: true,
    };
    setFiles(prev => {
      const existingIdx = prev.findIndex(f => (f.path || f.name).toLowerCase() === fileName.toLowerCase());
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          content: content || next[existingIdx].content,
          language: detectedLang || next[existingIdx].language,
          contentHash: computeContentHash(content || next[existingIdx].content),
          lastModified: Date.now(),
        };
        return next;
      }
      return [...prev, newFile];
    });
    const existing = files.find(f => (f.path || f.name).toLowerCase() === fileName.toLowerCase());
    setActiveFileId(existing ? existing.id : newId);
    if (!existing && workspace.project && collab.isHost && collab.status === 'connected') collab.shareFile({ id: newId, name: fileName, content, language: detectedLang });
    soundEffects.success();
    return newFile;
  }, [files, workspace.project?.id, collab.provider, collab.isHost, collab.status]);

  const handleAgentFileCreate = useCallback((name: string, content: string = '', language?: string) => {
    const path = name.trim();
    if (!path) return;
    const detected = language || detectLanguage(path, content) || 'plaintext';
    const newId = (crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setFiles(prev => {
      const existing = prev.find(f => (f.path || f.name) === path);
      if (existing) return prev.map(f => f.id === existing.id ? { ...f, content, language: detected,
        contentLoaded: true, contentHash: computeContentHash(content), lastModified: Date.now() } : f);
      return [...prev, { id: newId, name: path.split('/').pop() || path, path, content, language: detected,
        contentLoaded: true, contentHash: computeContentHash(content), lastModified: Date.now() }];
    });
  }, []);

  // Observe every shared document, including unopened tabs. Yjs is the source of truth.
  useEffect(() => {
    const provider = collab.provider;
    if (!provider || collab.status !== 'connected') return;
    const cleanups = collab.sharedFiles.map(shared => {
      const connection = provider.openFileConnection(shared.id);
      const text = connection.doc.getText('monaco');
      const sync = () => {
        if (!connection.synced) return;
        const content = text.toString();
        setFiles(prev => {
          const existing = prev.find(f => f.id === shared.id);
          if (existing && existing.content === content && existing.contentLoaded !== false) return prev;
          const updated: StoredFile = { ...existing, id: shared.id, name: shared.name.split('/').pop() || shared.name,
            path: shared.name, language: shared.language, content, contentLoaded: true,
            contentHash: computeContentHash(content), lastModified: Date.now() };
          return existing ? prev.map(f => f.id === shared.id ? updated : f) : [...prev, updated];
        });
        setActiveFileId(prev => prev || shared.id);
      };
      text.observe(sync);
      const off = connection.onSync(sync);
      return () => { text.unobserve(sync); off(); };
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, [collab.provider, collab.status, collab.sharedFiles]);

  // Auto-share the active file when host creates a room
  useEffect(() => {
    if (
      collab.isHost &&
      collab.status === 'connected' &&
      collab.sharedFiles.length === 0 &&
      !autoSharedRef.current
    ) {
      const file = activeFileId ? files.find(f => f.id === activeFileId) : null;
      if (file && file.contentLoaded !== false) {
        autoSharedRef.current = true;
        collab.shareFile({
          id: file.id,
          name: file.path || file.name,
          language: file.language,
          content: file.content,
        });
      }
    }
    if (collab.status === 'disconnected') {
      autoSharedRef.current = false;
    }
  }, [collab.isHost, collab.status, collab.sharedFiles.length, activeFileId, files]);

  // Auto-close the collab modal once join succeeds
  useEffect(() => {
    if (showCollabModal && (collab.status === 'waiting-approval' || collab.status === 'connected')) {
      setShowCollabModal(false);
    }
  }, [collab.status, showCollabModal]);

  useEffect(() => {
    const stored = getStoredFiles();
    const storedActive = getActiveFileId();
    setFiles(stored);
    if (stored.length > 0) {
      const active = storedActive && stored.some(f => f.id === storedActive)
        ? storedActive
        : stored[0].id;
      setActiveFileId(active);
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized) saveFiles(files);
  }, [files, isInitialized]);

  useEffect(() => {
    if (isInitialized && activeFileId) saveActiveFileId(activeFileId);
  }, [activeFileId, isInitialized]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (workspace.project && collab.status === 'connected' && !collab.isHost) { workspace.setError('Only the room host can import project files.'); return; }
    const text = await file.text();
    const fileId = Date.now().toString();
    const syncLanguage = detectLanguage(file.name, text);
    const newFile: StoredFile = {
      id: fileId,
      name: file.name,
      content: text,
      language: syncLanguage,
      contentHash: computeContentHash(text),
      lastModified: Date.now(),
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(fileId);
    // Refine with Magika AI in background
    detectLanguageAI(file.name, text).then(aiLang => {
      if (aiLang && aiLang !== syncLanguage) {
        setFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, language: aiLang } : f
        ));
      }
    });
  }, [workspace.project?.id, collab.status, collab.isHost]);

  const handleFileDelete = useCallback((id: string) => {
    if (workspace.project) { void workspace.removeFile(id).catch(err => workspace.setError(err.message)); return; }
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (activeFileId === id) {
        setActiveFileId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }, [activeFileId, workspace.project?.id, workspace.removeFile]);

  const handleCodeChange = useCallback((id: string, newCode: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id
        ? { ...f, content: newCode, contentHash: computeContentHash(newCode), lastModified: Date.now() }
        : f
    ));
  }, []);

  const handleLanguageChange = useCallback((id: string, language: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, language, lastModified: Date.now() } : f
    ));
  }, []);

  const handleGitHubImport = useCallback((fileName: string, content: string, language: string) => {
    if (workspace.project && collab.status === 'connected' && !collab.isHost) { workspace.setError('Only the room host can import project files.'); return; }
    const fileId = Date.now().toString();
    const newFile: StoredFile = {
      id: fileId,
      name: fileName,
      content,
      language,
      contentHash: computeContentHash(content),
      lastModified: Date.now(),
      contentLoaded: true,
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(fileId);
    soundEffects.success();
    // Refine with Magika AI in background
    detectLanguageAI(fileName, content).then(aiLang => {
      if (aiLang && aiLang !== language) {
        setFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, language: aiLang } : f
        ));
      }
    });
  }, [workspace.project?.id, collab.status, collab.isHost]);

  // ─── Full Repo Import ────────────────────────────────────────────────
  const handleRepoImport = useCallback((repo: GitHubRepo, tree: RepoTreeItem[]) => {
    if (workspace.project && collab.status === 'connected' && !collab.isHost) { workspace.setError('Only the room host can import project files.'); return; }
    // Filter to only blob (file) entries, skip dirs
    const fileEntries = tree.filter(item => item.type === 'blob');
    const newFiles: StoredFile[] = fileEntries.map((item, i) => {
      const fileName = item.path.split('/').pop() || item.path;
      return {
        id: `${Date.now()}-${i}`,
        name: fileName,
        content: '',  // lazy loaded
        language: detectLanguage(fileName, ''),
        contentHash: computeContentHash(''),
        lastModified: Date.now(),
        path: item.path,
        repoOrigin: {
          owner: repo.owner.login,
          repo: repo.name,
          branch: repo.default_branch,
        },
        contentLoaded: false,
      };
    });
    setFiles(prev => [...prev, ...newFiles]);
    if (newFiles.length > 0) setActiveFileId(newFiles[0].id);
    soundEffects.success();
  }, [workspace.project?.id, collab.status, collab.isHost]);

  // ─── Lazy File Select (loads content on demand) ──────────────────────
  const handleFileLoad = useCallback(async (id: string) => {
    // Check if this file needs lazy loading
    const file = files.find(f => f.id === id);
    if (file && file.repoOrigin && !file.contentLoaded) {
      setLoadingFileId(id);
      try {
        const token = getStoredToken();
        const content = await fetchRawContent(
          file.repoOrigin.owner, file.repoOrigin.repo,
          file.repoOrigin.branch, file.path || file.name, token
        );
        const syncLang = detectLanguage(file.name, content);
        setFiles(prev => prev.map(f =>
          f.id === id
            ? { ...f, content, language: syncLang, contentHash: computeContentHash(content), contentLoaded: true }
            : f
        ));
        // Refine with Magika AI in background
        detectLanguageAI(file.name, content).then(aiLang => {
          if (aiLang && aiLang !== syncLang) {
            setFiles(prev => prev.map(f =>
              f.id === id ? { ...f, language: aiLang } : f
            ));
          }
        });
      } catch (err) {
        console.error('Failed to load file content:', err);
        setFiles(prev => prev.map(f =>
          f.id === id
            ? { ...f, content: `// Error loading file: ${(err as Error).message}`, contentLoaded: true }
            : f
        ));
      } finally {
        setLoadingFileId(null);
      }
    }
  }, [files]);

  const handleFileSelect = useCallback((id: string) => {
    setActiveFileId(id);
    void handleFileLoad(id);
  }, [handleFileLoad]);

  // ─── Delete entire repo from sidebar ─────────────────────────────────
  const handleRepoDelete = useCallback((repoKey: string) => {
    setFiles(prev => {
      const next = prev.filter(f => {
        if (!f.repoOrigin) return true;
        return `${f.repoOrigin.owner}/${f.repoOrigin.repo}` !== repoKey;
      });
      if (activeFileId && !next.some(f => f.id === activeFileId)) {
        setActiveFileId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
    soundEffects.success();
  }, [activeFileId]);

  return (
    <ThemeContext.Provider value={themeCtx}>
      <ErrorBoundary>
        <div className="min-h-screen font-sans flex flex-col relative overflow-hidden">
          <EditorView
            workspace={workspace}
            files={files}
            activeFileId={activeFileId}
            loadingFileId={loadingFileId}
            onFileSelect={handleFileSelect}
            onFileLoad={handleFileLoad}
            onFileCreate={handleFileCreate}
            onAgentFileCreate={handleAgentFileCreate}
            onFileDelete={handleFileDelete}
            onFileUpload={handleFileUpload}
            onCodeChange={handleCodeChange}
            onLanguageChange={handleLanguageChange}
            onOpenGitHub={() => setShowGitHubModal(true)}
            onOpenGitHubPush={() => setShowGitHubPushModal(true)}
            onOpenCollab={() => setShowCollabModal(true)}
            onRepoDelete={handleRepoDelete}
            collab={collab}
          />
          <GitHubImportModal
            isOpen={showGitHubModal}
            onClose={() => setShowGitHubModal(false)}
            onImport={handleGitHubImport}
            onImportRepo={handleRepoImport}
          />
          <GitHubPushModal
            isOpen={showGitHubPushModal}
            onClose={() => setShowGitHubPushModal(false)}
            provider={collab.provider}
            files={files}
            activeFile={activeFileId ? files.find(f => f.id === activeFileId) || null : null}
            isInRoom={collab.status === 'connected'}
            sharedFiles={collab.sharedFiles}
          />
          <CollabRoomModal
            isOpen={showCollabModal}
            onClose={() => { setShowCollabModal(false); collab.clearJoinError(); }}
            onCreateRoom={(name, id) => { collab.createRoom(name, id); setShowCollabModal(false); soundEffects.success(); }}
            onJoinRoom={(name, id) => { collab.joinRoom(name, id); }}
            joinError={collab.joinError}
            onClearJoinError={collab.clearJoinError}
          />

        </div>
      </ErrorBoundary>
    </ThemeContext.Provider>
  );
};
