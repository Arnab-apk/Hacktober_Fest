/**
 * CollabMonacoEditor — Monaco editor wired to a per-file DocConnection.
 *
 * When a collab session is active and the user opens a shared file:
 *  - Opens a DocConnection to the file's Y.Doc on the socket server
 *  - Binds Y.Text to the Monaco model via y-monaco's MonacoBinding
 *  - Dynamically injects CSS for remote cursor I-beams + hover name labels
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { MonacoSurface as Editor } from './MonacoSurface';
import type * as Monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import { StoredFile } from '../services/storageService';
import { CollabProvider, DocConnection } from '../services/collabService';
import { Loader2 } from 'lucide-react';
import { registerEditorThemes } from '../utils/editorThemes';

interface Props {
  file: StoredFile;
  theme: 'dark' | 'light';
  fontSize: number;
  showMinimap?: boolean;
  provider: CollabProvider;
  onChange: (value: string) => void;
  onCursorChange: (ln: number, col: number) => void;
  onSelectionChange: (count: number) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  'JavaScript': 'javascript', 'TypeScript': 'typescript', 'Python': 'python',
  'Java': 'java', 'C++': 'cpp', 'C': 'c', 'Go': 'go', 'Rust': 'rust',
  'Ruby': 'ruby', 'PHP': 'php', 'HTML': 'html', 'CSS': 'css', 'JSON': 'json',
  'JSX': 'javascript', 'TSX': 'typescript',
};

// ─── Global cursor CSS (injected once) ─────────────────────────────────

let globalStylesInjected = false;
function ensureGlobalCursorStyles() {
  if (globalStylesInjected) return;
  globalStylesInjected = true;

  const el = document.createElement('style');
  el.id = 'yRemoteCursorGlobals';
  el.textContent = `
    /* Invisible hover zone (::before) — wide target for triggering name tag */
    .yRemoteSelectionHead::before {
      content: '';
      position: absolute;
      top: 0;
      left: -10px;
      width: 24px;
      height: 100%;
      cursor: default;
      z-index: 99;
    }

    /* Name tag (::after) — hidden by default */
    .yRemoteSelectionHead::after {
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
    }

    /* On hover: show name tag + stop blink so I-beam stays solid */
    .yRemoteSelectionHead:hover::after {
      opacity: 1;
    }

  `;
  document.head.appendChild(el);
}

// ─── Per-client cursor CSS injection ───────────────────────────────────

function injectCursorStyles(clientID: number, color: string, name: string) {
  const styleId = `yRemoteCursor-${clientID}`;
  if (document.getElementById(styleId)) return;

  ensureGlobalCursorStyles();

  const escapedName = name.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const el = document.createElement('style');
  el.id = styleId;
  el.textContent = `
    /* Selection highlight */
    .yRemoteSelection-${clientID} {
      background-color: ${color}20 !important;
    }
    /* Cursor I-beam line */
    .yRemoteSelectionHead-${clientID} {
      position: absolute;
      border-left: 2px solid ${color} !important;
      box-sizing: border-box;
      height: 100% !important;
    }
    /* Name tag positioned above cursor */
    .yRemoteSelectionHead-${clientID}::after {
      content: '${escapedName}';
      position: absolute;
      color: #fff;
      background-color: ${color};
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 2px 6px 3px;
      border-radius: 3px 3px 3px 0;
      white-space: nowrap;
      bottom: 100%;
      left: -2px;
      z-index: 100;
    }
  `;
  document.head.appendChild(el);
}

function removeCursorStyles(clientID: number) {
  document.getElementById(`yRemoteCursor-${clientID}`)?.remove();
}

// ─── Component ─────────────────────────────────────────────────────────

export const CollabMonacoEditor: React.FC<Props> = ({
  file, theme, fontSize, showMinimap = false, provider, onCursorChange, onSelectionChange,
}) => {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const docConnRef = useRef<DocConnection | null>(null);
  const injectedRef = useRef<Set<number>>(new Set());

  const cleanupBinding = useCallback(() => {
    if (bindingRef.current) {
      bindingRef.current.destroy();
      bindingRef.current = null;
    }
    injectedRef.current.forEach(id => removeCursorStyles(id));
    injectedRef.current.clear();
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.onDidDispose(cleanupBinding);
    monacoRef.current = monaco;

    registerEditorThemes(monaco);
    monaco.editor.setTheme(theme === 'dark' ? 'skiffy-dark' : 'skiffy-light');

    try {
      const diagOff = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
      monaco.languages.typescript?.typescriptDefaults?.setDiagnosticsOptions(diagOff);
      monaco.languages.typescript?.javascriptDefaults?.setDiagnosticsOptions(diagOff);
    } catch { /* ignore */ }

    editor.onDidChangeCursorPosition(e => {
      onCursorChange(e.position.lineNumber, e.position.column);
    });
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      if (sel) {
        const model = editor.getModel();
        if (model) onSelectionChange(model.getValueInRange(sel).length);
      }
    });

    // If provider is connected, bind now
    if (provider.status === 'connected') {
      bindToFile(editor, provider);
    }

  };

  // ── Bind to the current file's DocConnection ──────────────────────────

  const bindToFile = useCallback((
    editor: Monaco.editor.IStandaloneCodeEditor,
    prov: CollabProvider,
  ) => {
    cleanupBinding();

    // Open a doc connection for this file
    const docConn = prov.openFileConnection(file.id);
    docConnRef.current = docConn;

    const ytext = docConn.doc.getText('monaco');
    const model = editor.getModel();
    if (!model) return;

    // Create MonacoBinding — syncs text + renders remote cursors
    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      docConn.awareness,
    );
    bindingRef.current = binding;

    // Inject CSS for remote cursors when awareness changes
    const handleAwarenessChange = () => {
      const states = docConn.awareness.getStates();
      const localId = docConn.doc.clientID;

      // Inject styles for any new remote clients
      states.forEach((state, clientID) => {
        if (clientID === localId) return;
        if (injectedRef.current.has(clientID)) return;
        const user = state.user;
        if (user?.color && user?.name) {
          injectCursorStyles(clientID, user.color, user.name);
          injectedRef.current.add(clientID);
        }
      });

      // Clean up styles for disconnected clients
      const activeIds = new Set(states.keys());
      for (const id of injectedRef.current) {
        if (!activeIds.has(id)) {
          removeCursorStyles(id);
          injectedRef.current.delete(id);
        }
      }
    };

    // Initial pass + subscribe
    handleAwarenessChange();
    docConn.awareness.on('change', handleAwarenessChange);

    // Attach cleanup to binding destroy
    const origDestroy = binding.destroy.bind(binding);
    binding.destroy = () => {
      docConn.awareness.off('change', handleAwarenessChange);
      injectedRef.current.forEach(id => removeCursorStyles(id));
      injectedRef.current.clear();
      origDestroy();
    };
  }, [file.id, cleanupBinding]);

  // ── Effect: bind/unbind when file or provider changes ────────────────

  useEffect(() => {
    if (!editorRef.current || !provider || provider.status !== 'connected') return;

    bindToFile(editorRef.current, provider);

    return () => {
      cleanupBinding();
    };
  }, [provider, provider?.status, file.id, bindToFile, cleanupBinding]);

  // ── Sync external/agent content updates to the shared Y.Text ───────────
  // ── Theme update ─────────────────────────────────────────────────────

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(
        theme === 'dark' ? 'skiffy-dark' : 'skiffy-light',
      );
    }
  }, [theme]);

  const languageId = LANGUAGE_MAP[file.language] || file.language?.toLowerCase() || 'javascript';

  return (
    <div className="relative w-full h-full">
      <Editor
        height="100%"
        language={languageId}
        defaultValue=""
        theme={theme === 'dark' ? 'skiffy-dark' : 'skiffy-light'}
        beforeMount={registerEditorThemes}
                onMount={handleEditorDidMount}
        loading={
          <div className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: theme === 'dark' ? '#20242B' : '#FAFBFC' }}>
            <Loader2 className={`animate-spin ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} size={24} />
          </div>
        }
        options={{
          automaticLayout: true,
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: showMinimap, showSlider: 'mouseover', renderCharacters: true },
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          roundedSelection: false,
          padding: { top: 12, bottom: 12 },
          bracketPairColorization: { enabled: true },
          renderLineHighlight: 'line',
          contextmenu: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          stickyScroll: { enabled: false },
        }}
      />
    </div>
  );
};
