import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ImagePlus, Send, Square, Trash2, X } from 'lucide-react';
import { StoredFile } from '../services/storageService';
import { askGemma, gemmaStatus, readMentorImage, MentorImage, MentorMessage, MentorMode, GemmaProvider, GemmaStatus } from '../services/gemmaService';
import './GemmaPanel.css';

const MODES: { value: MentorMode; label: string; prompt: string }[] = [
  { value: 'explain', label: 'Explain code', prompt: 'Explain this code step by step and help me understand its key concepts.' },
  { value: 'review', label: 'Review bugs', prompt: 'Review this code for bugs and edge cases. Suggest focused fixes and tests.' },
  { value: 'debug', label: 'Debug screenshot', prompt: 'Help diagnose the error in my screenshot using the active file. What should I check and change?' },
  { value: 'plan', label: 'Build from design', prompt: 'Turn my idea or design screenshot into a practical implementation plan for this code.' },
];

// Render code fences as React text nodes; model-provided HTML is never executed.
function Answer({ text }: { text: string }) {
  return <div className="gemma-answer">{text.split(/```[^\n]*\n([\s\S]*?)```/g).map((part, index) => index % 2
    ? <pre key={index}><code>{part}</code></pre>
    : <div key={index} className="gemma-prose">{part}</div>)}</div>;
}

export function GemmaPanel({ activeFile }: { activeFile: StoredFile | null }) {
  const [mode, setMode] = useState<MentorMode>('explain');
  const [provider, setProvider] = useState<GemmaProvider>('ollama');
  const [model, setModel] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [input, setInput] = useState('');
  const [includeCode, setIncludeCode] = useState(true);
  const [image, setImage] = useState<(MentorImage & { name: string }) | null>(null);
  const [messages, setMessages] = useState<(MentorMessage & { context?: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<GemmaStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem('harness-access-token') || '');
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageVersion = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    setStatus(null);
    setStatusError('');
    gemmaStatus(token, abort.signal, provider).then(value => { if (!abort.signal.aborted) { setStatus(value); setModel(value.model); } }).catch(err => {
      if (!abort.signal.aborted) setStatusError(err.message || 'Could not check Gemma configuration.');
    });
    return () => abort.abort();
  }, [token, provider, refresh]);
  useEffect(() => () => { controller.current?.abort(); imageVersion.current++; }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);

  async function send() {
    const prompt = input.trim();
    if (!prompt || busy || imageBusy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    const codeFile = includeCode && activeFile?.contentLoaded !== false ? activeFile : null;
    const user: MentorMessage & { context?: string } = { role: 'user', content: prompt,
      context: [codeFile?.path || codeFile?.name, image?.name].filter(Boolean).join(' + ') };
    try {
      const result = await askGemma({ prompt, mode, provider, model,
        history: messages.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 16000) })),
        ...(codeFile ? { code: { path: codeFile.path || codeFile.name, language: codeFile.language || '',
          content: codeFile.content.slice(0, 24000), truncated: codeFile.content.length > 24000 } } : {}),
        ...(image ? { image: { mimeType: image.mimeType, data: image.data } } : {}),
      }, token, abort.signal);
      if (abort.signal.aborted) return;
      setMessages(previous => [...previous, user, { role: 'assistant' as const, content: result.text }].slice(-60));
      setInput('');
      if (result.finishReason === 'MAX_TOKENS') setError('The answer reached its length limit. Ask a follow-up to continue.');
      setStatus({ configured: true, model: result.model });
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Gemma could not answer. Try again.');
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  }

  async function attach(file?: File) {
    if (!file) return;
    const version = ++imageVersion.current;
    setImageBusy(true);
    setError('');
    try {
      const loaded = await readMentorImage(file);
      if (imageVersion.current === version) setImage({ ...loaded, name: file.name });
    } catch (err) {
      if (imageVersion.current === version) setError(err instanceof Error ? err.message : 'Could not load image.');
    } finally { if (imageVersion.current === version) setImageBusy(false); }
  }

  return <section className="gemma-panel" aria-label="Gemma Code Mentor">
    <header className="gemma-heading"><BookOpen size={20} aria-hidden="true" /><div><h2>Gemma Code Mentor</h2><p>Learn, review, and build with text + images</p></div></header>
    <details className="gemma-config mentor-settings"><summary className="mentor-settings-summary"><span>Model &amp; connection</span><small className={statusError || (status && !status.configured) ? 'mentor-connection-issue' : ''}>{statusError ? 'Connection issue' : status && !status.configured ? 'Setup needed' : status?.model || 'Connecting…'}</small></summary><div className="mentor-settings-body">
      <label htmlFor="gemma-provider">Run Gemma with</label><select id="gemma-provider" value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as GemmaProvider); setMessages([]); setError(''); }}>
        <option value="gemini">Gemini API · server key</option><option value="ollama">Ollama · my laptop</option><option value="openrouter">OpenRouter · server key</option>
      </select>
      <p className="gemma-model">{status?.model || 'Gemma 4'}</p>
      {provider === 'ollama' && !!status?.models?.length && <><label htmlFor="gemma-local-model">Installed Gemma model</label><select id="gemma-local-model" disabled={busy} value={model} onChange={event => { setModel(event.target.value); setMessages([]); }}>{status.models.map(name => <option key={name}>{name}</option>)}</select></>}
      {status && !status.configured && <p role="status">{provider === 'ollama' ? 'Install or select a Gemma 4 model in Ollama.' : `Set ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY'} in the server .env, then restart the app.`}</p>}
      {statusError && <p role="alert">{statusError}</p>}
      <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Check connection</button>
      <details><summary>Server access</summary><label htmlFor="gemma-token">Server access token</label><input id="gemma-token" type="password" autoComplete="off" value={token} disabled={busy} onChange={event => {
        setToken(event.target.value); sessionStorage.setItem('harness-access-token', event.target.value);
      }} /><p>Use the same access token as the Skippy harness for remote access.</p></details>
    </div></details>
    <div className="gemma-options"><label htmlFor="gemma-mode">What do you want to do?</label><select id="gemma-mode" value={mode} disabled={busy} onChange={event => setMode(event.target.value as MentorMode)}>
      {MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select><button className="gemma-example" disabled={busy} onClick={() => setInput(MODES.find(item => item.value === mode)!.prompt)}>Use example question</button></div>
    <div className="gemma-chat" role="log" aria-label="Mentor conversation" aria-live="polite" aria-busy={busy}>
      {!messages.length && <div className="gemma-empty"><h3>A second pair of eyes for your code</h3><p>Ask about the active file, attach an error screenshot, or share a design to plan your next feature.</p><p>Gemma gives advice and code examples. You choose which changes to make.</p></div>}
      {messages.map((message, index) => <article key={index} className={`gemma-message gemma-${message.role}`}><strong>{message.role === 'user' ? 'You' : 'Gemma'}</strong>
        {message.context && <small>Context: {message.context}</small>}<Answer text={message.content} /></article>)}
      {busy && <p role="status">Gemma is reading your context and preparing an answer…</p>}<div ref={end} />
    </div>
    <form className="gemma-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="gemma-context"><input type="checkbox" checked={includeCode} disabled={busy} onChange={event => setIncludeCode(event.target.checked)} />Include active file</label>
      <p className="gemma-context-name">{includeCode && activeFile ? (activeFile.path || activeFile.name) + (activeFile.contentLoaded === false ? ' (still loading; excluded)' : activeFile.content.length > 24000 ? ' (first 24,000 characters)' : '') : 'No code context attached'}</p>
      {image && <div className="gemma-attachment"><img src={`data:${image.mimeType};base64,${image.data}`} alt={`Attached screenshot: ${image.name}`} /><span>{image.name}</span><button type="button" disabled={busy} aria-label="Remove screenshot" onClick={() => setImage(null)}><X size={16} /></button></div>}
      <label htmlFor="gemma-question">Your question</label><textarea id="gemma-question" rows={3} maxLength={8000} value={input} disabled={busy} placeholder="Ask a question about your code or screenshot…" onChange={event => setInput(event.target.value)} />
      {error && <p className="gemma-error" role="alert">{error}</p>}
      <p className="gemma-disclosure">Included code, images, and recent chat are sent to {provider === 'ollama' ? 'your configured Ollama server' : provider === 'openrouter' ? 'OpenRouter and its model provider' : 'Google'}. Images stay attached for follow-ups until removed. Chat stays in this tab.</p>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="gemma-actions"><button type="button" disabled={busy || imageBusy} onClick={() => fileInput.current?.click()}><ImagePlus size={16} aria-hidden="true" />{imageBusy ? 'Reading…' : 'Image'}</button>
        <button type="button" aria-label="Clear mentor conversation" disabled={busy || !messages.length} onClick={() => { setMessages([]); setError(''); }}><Trash2 size={16} /></button>
        {busy ? <button key="stop" type="button" onClick={event => { event.preventDefault(); controller.current?.abort(); setError('Request stopped. Your question is ready to retry.'); }}><Square size={16} aria-hidden="true" />Stop</button>
          : <button key="send" type="submit" className="gemma-send" disabled={!input.trim() || imageBusy || !status?.configured}><Send size={16} aria-hidden="true" />Ask Gemma</button>}
      </div>
    </form>
  </section>;
}

export function AIWorkspacePanel({ activeFile, children }: { activeFile: StoredFile | null; children: React.ReactNode }) {
  const [selected, setSelected] = useState<'agent' | 'mentor'>('agent');
  return <div className="ai-workspace-panel"><nav className="gemma-tabs" aria-label="AI tools">
    <button type="button" aria-pressed={selected === 'agent'} onClick={() => setSelected('agent')}>Skippy Agent</button>
    <button type="button" aria-pressed={selected === 'mentor'} onClick={() => setSelected('mentor')}>Gemma Mentor</button>
  </nav><div className="ai-workspace-content" hidden={selected !== 'agent'}>{children}</div><div className="ai-workspace-content" hidden={selected !== 'mentor'}><GemmaPanel activeFile={activeFile} /></div></div>;
}
