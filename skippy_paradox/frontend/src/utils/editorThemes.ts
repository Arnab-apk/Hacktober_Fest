import type * as Monaco from 'monaco-editor';

export function registerEditorThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme('skiffy-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '9CA8B8', fontStyle: '' },
      { token: 'keyword', foreground: 'C6A0F6' },
      { token: 'string', foreground: 'A6D189' },
      { token: 'number', foreground: 'E5B482' },
      { token: 'type', foreground: 'E5C890' },
      { token: 'function', foreground: '8DB5E2' },
      { token: 'variable', foreground: 'DCE1EB' },
      { token: 'operator', foreground: '8BD5CA' },
    ],
    colors: {
      'editor.background': '#10141B', 'editor.foreground': '#E7EDF6',
      'editor.lineHighlightBackground': '#1A2230', 'editorLineNumber.foreground': '#8B96A8',
      'editorLineNumber.activeForeground': '#E7EDF6', 'editor.selectionBackground': '#273B59',
      'editor.inactiveSelectionBackground': '#253245', 'editorCursor.foreground': '#A9C7FF',
      'editorWhitespace.foreground': '#303B4B', 'editorIndentGuide.background1': '#343C49',
      'editorIndentGuide.activeBackground1': '#66758B',
      'editorWidget.background': '#1C2330', 'editorWidget.border': '#303B4B',
      'editorSuggestWidget.background': '#1C2330', 'editorSuggestWidget.border': '#303B4B',
      'editorSuggestWidget.foreground': '#E7EDF6', 'editorSuggestWidget.selectedBackground': '#273B59',
    },
  });
  monaco.editor.defineTheme('skiffy-light', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '647184', fontStyle: '' }, { token: 'keyword', foreground: '7443A8' },
      { token: 'string', foreground: '386525' }, { token: 'number', foreground: '9A4F13' },
      { token: 'type', foreground: '8D6217' }, { token: 'function', foreground: '285EAE' },
      { token: 'variable', foreground: '273448' }, { token: 'operator', foreground: '256F77' },
    ],
    colors: {
      'editor.background': '#FBFCFE', 'editor.foreground': '#263448',
      'editor.lineHighlightBackground': '#F0F4FA', 'editorLineNumber.foreground': '#647184',
      'editorLineNumber.activeForeground': '#263448', 'editor.selectionBackground': '#C9DCF7',
      'editor.inactiveSelectionBackground': '#E0E8F3', 'editorCursor.foreground': '#315F9F',
      'editorWhitespace.foreground': '#BAC3CF', 'editorIndentGuide.background1': '#DCE1E8',
      'editorIndentGuide.activeBackground1': '#9AA6B6',
      'editorWidget.background': '#FFFFFF', 'editorWidget.border': '#CDD7E5',
      'editorSuggestWidget.background': '#FFFFFF', 'editorSuggestWidget.border': '#CDD7E5',
      'editorSuggestWidget.foreground': '#263448', 'editorSuggestWidget.selectedBackground': '#E1EBFA',
    },
  });
}
