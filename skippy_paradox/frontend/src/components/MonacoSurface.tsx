import React, { useEffect, useRef, useState } from 'react';
import { loader, type EditorProps } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

/** Own the native editor lifecycle so pane moves and React effect replays cannot
 * leave a disposed editor in the wrapper's ready state. */
export const MonacoSurface: React.FC<EditorProps> = props => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const current = useRef(props);
  const applying = useRef(false);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let instance: Monaco.editor.IStandaloneCodeEditor | null = null;
    let model: Monaco.editor.ITextModel | null = null;
    const initialization = loader.init();
    initialization.then(monaco => {
      if (cancelled || !containerRef.current) return;
      monacoRef.current = monaco;
      const initial = current.current;
      initial.beforeMount?.(monaco);
      model = monaco.editor.createModel(initial.value ?? initial.defaultValue ?? '', initial.language || initial.defaultLanguage || 'plaintext');
      instance = monaco.editor.create(containerRef.current, {
        ...initial.options, model, theme: initial.theme, automaticLayout: true,
      });
      editorRef.current = instance;
      instance.onDidChangeModelContent(event => {
        if (!applying.current && instance) current.current.onChange?.(instance.getValue(), event);
      });
      initial.onMount?.(instance, monaco);
      setReady(true);
    }).catch(reason => { if (!cancelled) setError(reason?.message || 'Unable to load the editor.'); });
    return () => {
      cancelled = true;
      editorRef.current = null;
      instance?.dispose();
      model?.dispose();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !ready) return;
    editor.updateOptions(props.options || {});
    if (props.theme) monaco.editor.setTheme(props.theme);
    const model = editor.getModel();
    if (!model) return;
    if (props.language && model.getLanguageId() !== props.language) monaco.editor.setModelLanguage(model, props.language);
    if (props.value !== undefined && model.getValue() !== props.value) {
      applying.current = true;
      editor.executeEdits('workspace', [{ range: model.getFullModelRange(), text: props.value, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      applying.current = false;
    }
  }, [ready, props.language, props.value, props.theme, props.options]);

  return <div style={{ width: '100%', height: props.height || '100%', position: 'relative' }}>
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    {!ready && <div className="absolute inset-0 flex items-center justify-center">{error ? <span role="alert">{error}</span> : props.loading}</div>}
  </div>;
};
