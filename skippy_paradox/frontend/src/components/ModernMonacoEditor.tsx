import React, { useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { MonacoSurface as Editor } from './MonacoSurface';
import type * as Monaco from 'monaco-editor';
import { StoredFile } from '../services/storageService';
import { Loader2 } from 'lucide-react';
import { registerEditorThemes } from '../utils/editorThemes';

interface ModernMonacoEditorProps {
    file: StoredFile;
    theme: 'dark' | 'light';
    fontSize: number;
  showMinimap?: boolean;
    onChange: (value: string) => void;
    onCursorChange: (ln: number, col: number) => void;
    onSelectionChange: (count: number) => void;
}

// Map common language names to Monaco language IDs
const LANGUAGE_MAP: Record<string, string> = {
    'JavaScript': 'javascript',
    'TypeScript': 'typescript',
    'Python': 'python',
    'Java': 'java',
    'C++': 'cpp',
    'C': 'c',
    'Go': 'go',
    'Rust': 'rust',
    'Ruby': 'ruby',
    'PHP': 'php',
    'HTML': 'html',
    'CSS': 'css',
    'JSON': 'json',
    'JSX': 'javascript',
    'TSX': 'typescript'
};

export const ModernMonacoEditor: React.FC<ModernMonacoEditorProps> = ({
    file,
    theme,
    fontSize,
    showMinimap = false,
    onChange,
    onCursorChange,
    onSelectionChange,
}) => {
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Define custom themes
        registerEditorThemes(monaco);

        // Set the theme
        monaco.editor.setTheme(theme === 'dark' ? 'skiffy-dark' : 'skiffy-light');

        // Disable TypeScript/JavaScript diagnostics to prevent errors
        try {
            const tsDefaults = monaco.languages.typescript?.typescriptDefaults;
            const jsDefaults = monaco.languages.typescript?.javascriptDefaults;
            const diagOff = {
                noSemanticValidation: true,
                noSyntaxValidation: true,
                noSuggestionDiagnostics: true,
            };
            tsDefaults?.setDiagnosticsOptions(diagOff);
            jsDefaults?.setDiagnosticsOptions(diagOff);
        } catch {
            // Silently ignore
        }

        // Cursor position tracking
        editor.onDidChangeCursorPosition((e) => {
            onCursorChange(e.position.lineNumber, e.position.column);
        });

        // Selection tracking
        editor.onDidChangeCursorSelection(() => {
            const selection = editor.getSelection();
            if (selection) {
                const model = editor.getModel();
                if (model) {
                    const selectedText = model.getValueInRange(selection);
                    onSelectionChange(selectedText.length);
                }
            }
        });
    };

    const handleEditorChange = (value: string | undefined) => {
        if (value !== undefined) {
            onChange(value);
        }
    };

    // Update theme when it changes
    React.useEffect(() => {
        if (monacoRef.current) {
            monacoRef.current.editor.setTheme(theme === 'dark' ? 'skiffy-dark' : 'skiffy-light');
        }
    }, [theme]);

    const languageId = LANGUAGE_MAP[file.language] || file.language.toLowerCase() || 'javascript';

    return (
        <div className="relative w-full h-full">
            <Editor
                height="100%"
                language={languageId}
                value={file.content}
                theme={theme === 'dark' ? 'skiffy-dark' : 'skiffy-light'}
                onChange={handleEditorChange}
                beforeMount={registerEditorThemes}
                onMount={handleEditorDidMount}
                loading={
                    <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: theme === 'dark' ? '#20242B' : '#FAFBFC' }}>
                        <Loader2 className={`animate-spin ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} size={24} />
                    </div>
                }
                options={{
                    automaticLayout: true,
                    fontSize,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    minimap: {
                        enabled: showMinimap,
                        showSlider: 'mouseover',
                        renderCharacters: true,
                    },
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    roundedSelection: false,
                    padding: { top: 12, bottom: 12 },
                    bracketPairColorization: { enabled: true },
                    renderLineHighlight: 'line',
                    contextmenu: true,
                    scrollbar: {
                        verticalScrollbarSize: 10,
                        horizontalScrollbarSize: 10,
                    },
                    stickyScroll: {
                        enabled: false,
                    },
                }}
            />
        </div>
    );
};
