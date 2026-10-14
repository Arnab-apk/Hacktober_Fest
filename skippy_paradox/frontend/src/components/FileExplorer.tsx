import React, { useState, useMemo, useRef, useEffect } from 'react';
import { StoredFile } from '../services/storageService';
import { SharedFileInfo } from '../services/collabService';
import { useTheme } from '../hooks/useTheme';
import {
  FileCode, FolderOpen, FolderClosed, ChevronRight, ChevronDown,
  Trash2, Loader2, Package, Users, Plus, Minus, Folder, Check, X
} from 'lucide-react';
import { detectLanguage } from '../utils/detectLanguage';
import {
  JavaScript, TypeScript, Python, CPlusPlus, C, Java, Go, RustDark, Ruby, PHP
} from 'developer-icons';

// ─── Tree Node Types ───────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  fileId?: string;
  isDir: boolean;
  repoKey?: string;
}

// ─── Language Icons ────────────────────────────────────────────────────

const langIconMap: Record<string, { icon: any }> = {
  JavaScript: { icon: JavaScript }, TypeScript: { icon: TypeScript },
  Python: { icon: Python }, 'C++': { icon: CPlusPlus }, C: { icon: C },
  Java: { icon: Java }, Go: { icon: Go }, Rust: { icon: RustDark },
  Ruby: { icon: Ruby }, PHP: { icon: PHP },
};

function LangIcon({ language, size = 14 }: { language: string; size?: number }) {
  const entry = langIconMap[language];
  if (!entry) return <FileCode size={size} />;
  const Icon = entry.icon;
  return <span style={{ display: 'inline-flex', alignItems: 'center' }}><Icon size={size} /></span>;
}

// ─── Build Tree ────────────────────────────────────────────────────────

function buildTree(files: StoredFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isDir: true };

  for (const file of files) {
    const groupName = file.repoOrigin
      ? `${file.repoOrigin.owner}/${file.repoOrigin.repo}`
      : '';
    const filePath = file.path || file.name;
    const fullPath = groupName ? `${groupName}/${filePath}` : filePath;
    const parts = fullPath.split('/');

    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          isDir: !isLast,
          repoKey: groupName || undefined,
        });
      }

      const node = current.children.get(part)!;
      if (isLast) {
        node.fileId = file.id;
        node.isDir = false;
      }
      current = node;
    }
  }

  return root;
}

// ─── Context Menu ──────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  fileId: string;
  isInCollab: boolean;
}

function ContextMenu({
  state, onClose, onAddToCollab, onRemoveFromCollab, isDark,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onAddToCollab: (fileId: string) => void;
  onRemoveFromCollab: (fileId: string) => void;
  isDark: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`fixed z-[100] rounded shadow-none border py-1 min-w-[180px] animate-fade-in ${
        isDark
          ? 'bg-[var(--ide-bg)] border-[var(--ide-border)] text-[var(--ide-text)]'
          : 'bg-white border-[var(--ide-border)] text-[var(--ide-text)]'
      }`}
      style={{ left: state.x, top: state.y }}
    >
      {state.isInCollab ? (
        <button
          onClick={() => { onRemoveFromCollab(state.fileId); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
            isDark ? 'hover:bg-red-500/15 text-red-400' : 'hover:bg-red-50 text-red-500'
          }`}
        >
          <Minus size={13} /> Remove from Collab
        </button>
      ) : (
        <button
          onClick={() => { onAddToCollab(state.fileId); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
            isDark ? 'hover:bg-orange-500/15 text-orange-400' : 'hover:bg-orange-50 text-orange-600'
          }`}
        >
          <Plus size={13} /> Add to Collab
        </button>
      )}
    </div>
  );
}

// ─── Tree Node Renderer ───────────────────────────────────────────────

function TreeItem({
  node, depth, activeFileId, loadingFileId, onFileSelect, onFileDelete, onRepoDelete,
  onContextMenu, expandedPaths, toggleExpand, files, isDark, isCollabSection,
  onDragStart, onDragEnd,
}: {
  node: TreeNode; depth: number; activeFileId: string | null; loadingFileId: string | null;
  onFileSelect: (id: string) => void; onFileDelete: (id: string) => void;
  onRepoDelete?: (repoKey: string) => void;
  onContextMenu?: (e: React.MouseEvent, fileId: string, isInCollab: boolean) => void;
  expandedPaths: Set<string>; toggleExpand: (path: string) => void;
  files: StoredFile[]; isDark: boolean; isCollabSection?: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isActive = node.fileId === activeFileId;
  const isLoading = node.fileId === loadingFileId;
  const isRepoRoot = depth === 0 && node.repoKey;
  const textMuted = isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]';

  const storedFile = node.fileId ? files.find(f => f.id === node.fileId) : null;

  if (node.isDir) {
    const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <div>
        <div className="group flex items-center"><button
          aria-expanded={isExpanded}
          onClick={() => toggleExpand(node.path)}
          className={`w-full flex items-center gap-1.5 py-1 pr-2 rounded group transition-all duration-150 ease-out ${isDark ? 'hover:bg-[var(--ide-bg)]' : 'hover:bg-[var(--ide-hover)]'}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isExpanded
            ? <ChevronDown size={12} className={textMuted} />
            : <ChevronRight size={12} className={textMuted} />
          }
          {isRepoRoot
            ? <Package size={14} className="text-[var(--ide-accent)] shrink-0" />
            : isExpanded
              ? <FolderOpen size={14} className="text-[var(--ide-accent)] shrink-0" />
              : <FolderClosed size={14} className="text-[var(--ide-accent)] shrink-0" />
          }
          <span className={`text-[13px] truncate ${isRepoRoot ? 'font-semibold text-[var(--ide-accent)]' : isDark ? 'text-[var(--ide-text)]' : 'text-[var(--ide-muted)]'}`}>
            {node.name}
          </span>
        </button>
          {isRepoRoot && onRepoDelete && (
            <button
              aria-label={'Remove repository ' + node.name}
              onClick={e => { e.stopPropagation(); onRepoDelete(node.repoKey!); }}
              className="ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-400 p-0.5 transition-opacity"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
        {isExpanded && sortedChildren.map(child => (
          <TreeItem
            key={child.path} node={child} depth={depth + 1}
            activeFileId={activeFileId} loadingFileId={loadingFileId}
            onFileSelect={onFileSelect} onFileDelete={onFileDelete}
            onRepoDelete={onRepoDelete} onContextMenu={onContextMenu}
            expandedPaths={expandedPaths} toggleExpand={toggleExpand}
            files={files} isDark={isDark} isCollabSection={isCollabSection}
            onDragStart={onDragStart} onDragEnd={onDragEnd}
          />
        ))}
      </div>
    );
  }

  // File node
  return (
    <div
      onContextMenu={(e) => {
        if (onContextMenu && node.fileId) {
          e.preventDefault();
          onContextMenu(e, node.fileId, !!isCollabSection);
        }
      }}
      draggable
      onDragStart={() => node.fileId && onDragStart(node.fileId)}
      onDragEnd={onDragEnd}
      className={`w-full flex items-center gap-1.5 py-1 pr-2 rounded group transition-all duration-150 ease-out cursor-grab active:cursor-grabbing ${
        isActive
          ? isDark
            ? 'bg-[var(--ide-bg)] text-[var(--ide-accent)]'
            : 'bg-[var(--ide-selected)] text-[var(--ide-accent)]'
          : isDark
            ? 'text-[var(--ide-muted)] hover:bg-[var(--ide-bg)] hover:text-[var(--ide-text)]'
            : 'text-[var(--ide-muted)] hover:bg-[var(--ide-hover)] hover:text-[var(--ide-text)]'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" aria-current={isActive ? 'true' : undefined} onClick={() => node.fileId && onFileSelect(node.fileId)}>
      {isLoading
        ? <Loader2 size={13} className="animate-spin text-[var(--ide-accent)] shrink-0" />
        : <LangIcon language={storedFile?.language || ''} size={13} />
      }
      <span className="text-[13px] truncate">{node.name}</span>
      </button>
      {!isCollabSection && !node.repoKey && (
        <button
          aria-label={'Delete file ' + node.name}
          onClick={e => { e.stopPropagation(); node.fileId && onFileDelete(node.fileId); }}
          className="ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-400 p-0.5 transition-opacity"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────

interface FileExplorerProps {
  files: StoredFile[];
  activeFileId: string | null;
  loadingFileId: string | null;
  onFileSelect: (id: string) => void;
  onFileDelete: (id: string) => void;
  onRepoDelete?: (repoKey: string) => void;
  onFileCreate?: (name?: string, content?: string, language?: string) => void;
  triggerNewFile?: number;
  // Collab
  isInRoom: boolean;
  isHost: boolean;
  sharedFiles: SharedFileInfo[];
  collabFileContents: Map<string, StoredFile>;
  onAddToCollab?: (fileId: string) => void;
  onRemoveFromCollab?: (fileId: string) => void;
  onSelectCollabFile?: (fileId: string) => void;
  onReorderCollabFiles?: (newOrder: SharedFileInfo[]) => void;
}

// ─── Main Component ────────────────────────────────────────────────────

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files, activeFileId, loadingFileId, onFileSelect, onFileDelete, onRepoDelete,
  onFileCreate, triggerNewFile,
  isInRoom, isHost, sharedFiles, collabFileContents,
  onAddToCollab, onRemoveFromCollab, onSelectCollabFile, onReorderCollabFiles,
}) => {
  const { isDark } = useTheme();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  
  // Inline File Creation State
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (triggerNewFile && triggerNewFile > 0) {
      setIsCreating(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [triggerNewFile]);

  const previewLang = useMemo(() => {
    return newFileName.trim() ? detectLanguage(newFileName.trim(), '') : '';
  }, [newFileName]);

  const handleCommitNewFile = () => {
    const name = newFileName.trim();
    if (!name) return;
    const lang = detectLanguage(name, '');
    if (onFileCreate) {
      onFileCreate(name, '', lang);
    }
    setIsCreating(false);
    setNewFileName('');
  };

  // DND State
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isOverCollab, setIsOverCollab] = useState(false);
  const [isOverLocal, setIsOverLocal] = useState(false);

  // Build tree from non-collab files only
  const localFiles = useMemo(() => {
    if (!isInRoom) return files;
    const sharedIds = new Set(sharedFiles.map(f => f.id));
    return files.filter(f => !sharedIds.has(f.id));
  }, [files, isInRoom, sharedFiles]);

  const tree = useMemo(() => buildTree(localFiles), [localFiles]);

  // Auto-expand repo roots
  useMemo(() => {
    const newExpanded = new Set(expandedPaths);
    tree.children.forEach((child) => {
      if (child.isDir && child.repoKey && !expandedPaths.has(child.path)) {
        newExpanded.add(child.path);
      }
    });
    if (newExpanded.size !== expandedPaths.size) {
      setExpandedPaths(newExpanded);
    }
  }, [tree]);

  const sortedChildren = Array.from(tree.children.values()).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Build collab file tree for the collab section
  const collabFiles = useMemo(() => {
    return sharedFiles.map(sf => {
      const local = collabFileContents.get(sf.id);
      return {
        ...sf,
        storedFile: local || { id: sf.id, name: sf.name, language: sf.language, content: '', contentHash: '', lastModified: Date.now() } as StoredFile,
      };
    });
  }, [sharedFiles, collabFileContents]);

  return (
    <div className="space-y-0.5 text-sm">
      {/* ── Collab Section ───────────────────────────────────────── */}
      {isInRoom && (
        <div className="mb-3">
          {/* Collab header */}
          <div className={`flex items-center gap-2 px-2 py-1.5 mb-[1px] ${
            isDark ? 'text-[var(--ide-text)]' : 'text-[var(--ide-text)]'
          }`}>
            <Users size={13} className={isDark ? 'text-[var(--ide-accent)]' : 'text-[var(--ide-accent)]'} />
            <span className="text-[11px] font-medium tracking-wide uppercase">
              Collab
            </span>
            <span className={`text-[10px] ml-auto font-medium ${isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]'}`}>
              {sharedFiles.length} file{sharedFiles.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={`mx-2 border-b ${isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]'} mb-[9px]`} />

          {/* Collab files / Drop zone */}
          <div 
            className={`relative rounded transition-all duration-200 min-h-[40px] ${
              isOverCollab 
                ? isDark ? 'bg-[var(--ide-selected)] ring-1 ring-[var(--ide-accent)]' : 'bg-[var(--ide-selected)] ring-1 ring-[var(--ide-accent)]'
                : ''
            }`}
            onDragOver={e => {
              e.preventDefault();
              if (draggedFileId && !sharedFiles.some(f => f.id === draggedFileId)) {
                setIsOverCollab(true);
              }
            }}
            onDragLeave={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (
                e.clientX < rect.left ||
                e.clientX >= rect.right ||
                e.clientY < rect.top ||
                e.clientY >= rect.bottom
              ) {
                setIsOverCollab(false);
              }
            }}
            onDrop={e => {
              e.preventDefault();
              setIsOverCollab(false);
              if (draggedFileId && onAddToCollab && !sharedFiles.some(f => f.id === draggedFileId)) {
                onAddToCollab(draggedFileId);
              }
            }}
          >
            {isOverCollab && (
              <div className="absolute inset-0 pointer-events-none z-10 rounded backdrop-blur-[1.5px] bg-[var(--ide-selected)]" />
            )}
            {collabFiles.length === 0 ? (
              <div className={`flex items-center justify-center py-4 ${isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]'}`}>
                <span className="text-[11px] italic">No files</span>
              </div>
            ) : (
              collabFiles.map((cf, index) => (
                <div
                  key={cf.id}
                  onContextMenu={(e) => {
                    if (isHost) {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, fileId: cf.id, isInCollab: true });
                    }
                  }}
                  draggable
                  onDragStart={() => {
                    setDraggedFileId(cf.id);
                    setDraggedIndex(index);
                  }}
                  onDragEnd={() => {
                    setDraggedFileId(null);
                    setDraggedIndex(null);
                    setIsOverCollab(false);
                    setIsOverLocal(false);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== index && isHost) {
                      const newOrder = [...sharedFiles];
                      const [removed] = newOrder.splice(draggedIndex, 1);
                      newOrder.splice(index, 0, removed);
                      onReorderCollabFiles?.(newOrder);
                      setDraggedIndex(index);
                    }
                  }}
                  className={`w-full flex items-center gap-1.5 py-1.5 pr-2 pl-2 rounded group transition-all duration-150 ease-out cursor-grab active:cursor-grabbing ${
                    activeFileId === cf.id
                      ? isDark
                        ? 'bg-[var(--ide-bg)] text-[var(--ide-accent)]'
                        : 'bg-[var(--ide-selected)] text-[var(--ide-accent)]'
                      : isDark
                        ? 'text-[var(--ide-muted)] hover:bg-[var(--ide-bg)] hover:text-[var(--ide-text)]'
                        : 'text-[var(--ide-muted)] hover:bg-[var(--ide-hover)] hover:text-[var(--ide-text)]'
                  }`}

                >
                  <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => onSelectCollabFile?.(cf.id)}>
                  <LangIcon language={cf.language} size={13} />
                  <span className="text-[13px] truncate">{cf.name}</span>
                  </button>
                  {isHost && (
                    <button
                      onClick={e => { e.stopPropagation(); onRemoveFromCollab?.(cf.id); }}
                      className="ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-400 p-0.5 transition-opacity"
                      title="Remove from collab"
                      aria-label={'Remove ' + cf.name + ' from collaboration'}
                    >
                      <Minus size={11} />
                    </button>
                  )}
                </div>
              ))
            )}
            </div>
          </div>
        )}

      {/* ── Regular Files Section ────────────────────────────────── */}
      {/* ── Regular Files Section ────────────────────────────────── */}
      <div className="mb-3">
        <div className={`flex items-center gap-2 px-2 py-1.5 mb-[1px] ${
          isDark ? 'text-[var(--ide-text)]' : 'text-[var(--ide-text)]'
        }`}>
          <Folder size={13} className={isDark ? 'text-[var(--ide-accent)]' : 'text-[var(--ide-accent)]'} />
          <span className="text-[11px] font-medium tracking-wide uppercase">
            My Files
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => {
                setIsCreating(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className={`p-1 rounded hover:bg-[var(--ide-hover)] text-[var(--ide-accent)] hover:text-[var(--ide-accent)] transition-colors flex items-center justify-center`}
              title="Add New File"
            >
              <Plus size={13} />
            </button>
            <span className={`text-[10px] font-medium ${isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]'}`}>
              {localFiles.length} file{localFiles.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className={`mx-2 border-b ${isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]'} mb-[9px]`} />
        
        <div 
          className={`relative rounded transition-all duration-200 min-h-[40px] pb-2 ${
            isOverLocal
              ? isDark ? 'bg-[var(--ide-selected)] ring-1 ring-[var(--ide-accent)]' : 'bg-[var(--ide-selected)] ring-1 ring-[var(--ide-accent)]'
              : ''
          }`}
          onDragOver={e => {
            e.preventDefault();
            if (draggedFileId && sharedFiles.some(f => f.id === draggedFileId)) {
              setIsOverLocal(true);
            }
          }}
          onDragLeave={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX >= rect.right ||
              e.clientY < rect.top ||
              e.clientY >= rect.bottom
            ) {
              setIsOverLocal(false);
            }
          }}
          onDrop={e => {
            e.preventDefault();
            setIsOverLocal(false);
            if (draggedFileId && onRemoveFromCollab && sharedFiles.some(f => f.id === draggedFileId)) {
              onRemoveFromCollab(draggedFileId);
            }
          }}
        >
          {isOverLocal && (
            <div className="absolute inset-0 pointer-events-none z-10 rounded backdrop-blur-[1.5px] bg-[var(--ide-selected)]" />
          )}

          {/* Inline New File Creator */}
          {isCreating && (
            <div className="px-1.5 mb-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCommitNewFile();
                }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded border shadow-none transition-all ${
                  isDark
                    ? 'bg-[var(--ide-panel)] border-[var(--ide-border)] ring-1 ring-[var(--ide-accent)]'
                    : 'bg-white border-[var(--ide-border)] ring-1 ring-[var(--ide-accent)]'
                }`}
              >
                <div className="shrink-0 flex items-center justify-center">
                  <LangIcon language={previewLang} size={14} />
                </div>
                <input
                  aria-label="New file name"
                  ref={inputRef}
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsCreating(false);
                      setNewFileName('');
                    }
                  }}
                  placeholder="filename.ext (e.g. index.py, main.js)"
                  className={`w-full bg-transparent text-xs font-mono outline-none ${
                    isDark ? 'text-white placeholder:text-[var(--ide-muted)]' : 'text-[var(--ide-text)] placeholder:text-[var(--ide-muted)]'
                  }`}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!newFileName.trim()}
                  className="shrink-0 p-1 rounded hover:bg-emerald-500/20 text-[var(--ide-success)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  title="Create file (Enter)"
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setNewFileName('');
                  }}
                  className="shrink-0 p-1 rounded hover:bg-red-500/20 text-[var(--ide-muted)] hover:text-red-400 transition-colors"
                  title="Cancel (Esc)"
                >
                  <X size={12} />
                </button>
              </form>
            </div>
          )}

          {sortedChildren.length === 0 && !isCreating ? (
            <div className={`flex items-center justify-center py-4 ${isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]'}`}>
              <span className="text-[11px] italic">No files</span>
            </div>
          ) : (
            sortedChildren.map(child => (
              <TreeItem
                key={child.path} node={child} depth={0}
                activeFileId={activeFileId} loadingFileId={loadingFileId}
                onFileSelect={onFileSelect} onFileDelete={onFileDelete}
                onRepoDelete={onRepoDelete}
                onContextMenu={(e, id, collab) => setContextMenu({ x: e.clientX, y: e.clientY, fileId: id, isInCollab: collab })}
                expandedPaths={expandedPaths}
                toggleExpand={path => {
                  const next = new Set(expandedPaths);
                  next.has(path) ? next.delete(path) : next.add(path);
                  setExpandedPaths(next);
                }}
                files={files}
                isDark={isDark}
                onDragStart={setDraggedFileId}
                onDragEnd={() => {
                  setDraggedFileId(null);
                  setIsOverCollab(false);
                  setIsOverLocal(false);
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Context Menu ─────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onAddToCollab={(fileId) => onAddToCollab?.(fileId)}
          onRemoveFromCollab={(fileId) => onRemoveFromCollab?.(fileId)}
          isDark={isDark}
        />
      )}
    </div>
  );
};
