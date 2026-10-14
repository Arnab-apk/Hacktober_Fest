import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bot, Send, Square, RefreshCw, Settings, FileCode, Download } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { StoredFile } from '../services/storageService';
import { CollabProvider, SharedFileInfo } from '../services/collabService';
import { approveCommand, cancelRun, HarnessEvent, hydrateFiles, loadModels, streamHarness } from '../services/harnessService';
import { detectLanguage } from '../utils/detectLanguage';

interface Props {
  beginAgent?: () => Promise<() => Promise<void>>;
  activeFile: StoredFile | null;
  allFiles?: StoredFile[];
  onCodeChange?: (id: string, content: string) => void;
  onFileCreate?: () => void;
  onAgentFileCreate?: (path: string, content: string, language?: string) => void;
  provider?: CollabProvider | null;
  sharedFiles?: SharedFileInfo[];
}

export const HarnessPanel: React.FC<Props> = ({ allFiles = [], onAgentFileCreate, provider: room, sharedFiles = [], beginAgent }) => {
  const { isDark } = useTheme();
  const [provider, setProvider] = useState<'ollama' | 'openrouter' | 'gemini'>(() => {
    const saved = localStorage.getItem('harness-provider');
    return saved === 'gemini' || saved === 'openrouter' ? saved : 'ollama';
  });
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  // Provider credentials are managed on the server, never in browser storage.
  const apiKey = '';
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('harness-access-token') || '');
  const [settings, setSettings] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState('');
  const [conflicts, setConflicts] = useState<HarnessEvent[]>([]);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<{ id: string; token: string } | null>(null);
  const filesRef = useRef(allFiles);
  filesRef.current = allFiles;
  const bottomRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  const append = (event: HarnessEvent) => setEvents(prev => {
    if (event.type === 'status') return [...prev.filter(e => e.type !== 'status'), event].slice(-200);
    if (event.type === 'tool' && event.id && prev.some(e => e.id === event.id)) return prev.map(e => e.id === event.id ? { ...e, ...event } : e);
    return [...prev.filter(e => e.type !== 'status'), event].slice(-200);
  });

  useEffect(() => {
    sessionStorage.removeItem('harness-openrouter-key');
    localStorage.removeItem('openrouter-api-key');
    localStorage.removeItem('gemini-api-key');
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events, approval]);
  useEffect(() => {
    setEvents(room?.agentEvents.map(e => e.event) || []);
    setHistory([]);
    setRemoteBusy(!!room?.agentOwner && room.agentOwner !== room.peerId);
    return room?.onAgentEvent(message => {
      if (message.type === 'agent-event') append(message.event);
      if (message.type === 'agent-owner') setRemoteBusy(!!message.peerId && message.peerId !== room.peerId);
      if (message.type === 'agent-disconnected') { abortRef.current?.abort(); setRemoteBusy(false); }
    });
  }, [room]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (runRef.current) void cancelRun(runRef.current.id, runRef.current.token);
    room?.releaseAgent();
  }, [room]);

  async function refreshModels(selectedProvider = provider) {
    const ticket = ++generation.current;
    setLoadingModels(true); setError('');
    try {
      const data = await loadModels(selectedProvider, apiKey, accessToken);
      if (ticket !== generation.current) return;
      setModels(data.models);
      const saved = localStorage.getItem(`harness-model-${selectedProvider}`);
      const selected = data.models.includes(saved)
        ? saved
        : data.models.find((m: string) => /gemma.?4/i.test(m)) || data.models[0] || 'nvidia/nemotron-3.5-lightning:free';
      setModel(selected);
      localStorage.setItem(`harness-model-${selectedProvider}`, selected);
    } catch (err: any) { if (ticket === generation.current) setError(err.message); }
    finally { if (ticket === generation.current) setLoadingModels(false); }
  }
  useEffect(() => {
    localStorage.setItem('harness-provider', provider);
    const initialModel = localStorage.getItem(`harness-model-${provider}`) || (provider === 'gemini' ? 'gemma-4-26b-a4b-it' : '');
    setModel(initialModel);
    void refreshModels(provider);
  }, [provider]);

  async function start() {
    if (!prompt.trim() || busy || remoteBusy) return;
    const question = prompt.trim();
    setBusy(true); setError(''); setApproval('');
    const controller = new AbortController(); abortRef.current = controller;
    let claimed = false;
    let finishWorkspace: (() => Promise<void>) | undefined;
    let answer = '';
    const activeRoom = room?.status === 'connected' ? room : null;
    try {
      const chosenModel = model || (provider === 'gemini' ? 'gemma-4-26b-a4b-it' : '');
      if (!chosenModel) throw new Error('Refresh models and select one first.');
      if (activeRoom) { await activeRoom.claimAgent(); claimed = true; }
      if (beginAgent) finishWorkspace = await beginAgent();
      let files: StoredFile[];
      if (activeRoom) {
        await Promise.all(sharedFiles.map(f => activeRoom.openFileConnection(f.id).waitForSync()));
        files = sharedFiles.map(f => ({ ...f, path: f.name, content: activeRoom.openFileConnection(f.id).doc.getText('monaco').toString(), contentHash: '', lastModified: Date.now(), contentLoaded: true }));
      } else files = await hydrateFiles(filesRef.current);
      const paths = files.map(f => f.path || f.name);
      if (new Set(paths).size !== paths.length) throw new Error('Workspace has duplicate file paths. Rename or remove duplicates before using the harness.');
      const baseline = new Map(files.map(f => [f.path || f.name, f.content]));
      setPrompt('');
      const userEvent = { type: 'user', content: question };
      append(userEvent); activeRoom?.publishAgentEvent(userEvent);
      await streamHarness({ provider, model: chosenModel, apiKey: provider === 'openrouter' ? apiKey : '', prompt: question,
        history: history.slice(-10), files: files.map(f => ({ path: f.path || f.name, content: f.content })) }, accessToken, controller.signal, async event => {
        if (event.type === 'started') { runRef.current = { id: event.runId!, token: event.token! }; return; }
        if (event.type === 'approval') { setApproval(event.reason || 'Approve command?'); return; }
        if (event.type === 'file') {
          const path = event.path!;
          try {
            if (activeRoom) {
              await activeRoom.applyAgentEdit(path, event.content!, event.previous ?? null, detectLanguage(path, event.content!) || 'plaintext');
            } else {
              const current = filesRef.current.find(f => (f.path || f.name) === path);
              const currentContent = current?.contentLoaded === false ? baseline.get(path) : current?.content;
              if (currentContent !== (event.previous ?? undefined) && currentContent !== event.content) throw new Error(`Conflict in ${path}: the file changed while the agent was working. Download the proposed edit to review it.`);
              onAgentFileCreate?.(path, event.content!, detectLanguage(path, event.content!));
              // Synchronous ref update handles multiple edits before React's next render.
              filesRef.current = current ? filesRef.current.map(f => f === current ? { ...f, content: event.content!, contentLoaded: true } : f) : [...filesRef.current, { id: path, name: path, path, content: event.content!, language: 'plaintext', contentHash: '', lastModified: Date.now(), contentLoaded: true }];
            }
            baseline.set(path, event.content!);
            append({ type: 'file', path, message: `Updated ${path}` });
          } catch (err: any) {
            setConflicts(prev => [...prev, event]);
            append({ type: 'error', message: err.message });
            activeRoom?.publishAgentEvent({ type: 'error', message: err.message });
            throw new Error('Stopped to protect concurrent edits. Review the proposed file below, then retry.');
          }
          return;
        }
        if (event.type === 'message') answer += (answer ? '\n\n' : '') + event.content;
        if (event.type === 'error') setError(event.message || 'Harness failed.');
        append(event); activeRoom?.publishAgentEvent(event);
      });
      setHistory(prev => [...prev, { role: 'user', content: question } as const, ...(answer ? [{ role: 'assistant', content: answer.slice(-32000) } as const] : [])].slice(-12));
    } catch (err: any) {
      const message = err.name === 'AbortError' ? 'Run stopped. Applied edits are saved.' : err.message;
      setError(message); append({ type: 'error', message }); activeRoom?.publishAgentEvent({ type: 'error', message });
    } finally {
      if (runRef.current) void cancelRun(runRef.current.id, runRef.current.token);
      runRef.current = null; abortRef.current = null;
      try { await finishWorkspace?.(); } catch (error: any) { setError(error.message); }
      if (claimed) activeRoom?.releaseAgent();
      setBusy(false); setApproval('');
    }
  }

  async function decide(approved: boolean) {
    if (!runRef.current) return;
    try { await approveCommand(runRef.current.id, runRef.current.token, approved); setApproval(''); }
    catch (err: any) { setError(err.message); }
  }

  function download(event: HarnessEvent) {
    const url = URL.createObjectURL(new Blob([event.content || ''], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = (event.path || 'proposed.txt').split('/').pop()!; anchor.click(); URL.revokeObjectURL(url);
  }

  const field = `w-full rounded border px-2 py-2 text-xs outline-none focus:border-[var(--ide-border)] ${isDark ? 'bg-[var(--ide-bg)] border-[var(--ide-border)]' : 'bg-white border-[var(--ide-border)]'}`;
  return <section className="ide-agent flex h-full min-h-0 flex-col">
<header className="ide-agent-heading"><div><Bot size={15} /><strong>Agent</strong><small>{room?.status === 'connected' ? 'Shared' : 'Local'}</small></div><button aria-label="Agent settings" aria-expanded={settings} onClick={() => setSettings(!settings)} className="ide-icon-button"><Settings size={14} /></button></header>
    <div className="space-y-2 border-b border-[var(--ide-border)] p-3">
      <div className="flex gap-2">
        <select aria-label="AI provider" disabled={busy} className={field} value={provider} onChange={e => setProvider(e.target.value as any)}>
          <option value="gemini">Gemma 4 · Gemini API</option>
          <option value="openrouter">OpenRouter · cloud</option>
          <option value="ollama">Ollama · local</option>
        </select>
        <button aria-label="Refresh models" disabled={busy || loadingModels} onClick={() => void refreshModels()} className="p-2 text-[var(--ide-accent)]">
          <RefreshCw size={16} className={loadingModels ? 'animate-spin' : ''} />
        </button>
      </div>
      <select aria-label="AI model" disabled={busy || loadingModels} className={field} value={model} onChange={e => { setModel(e.target.value); localStorage.setItem(`harness-model-${provider}`, e.target.value); }}>
        <option value="">{loadingModels ? 'Loading models…' : 'Select a model'}</option>
        {models.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      {settings && <div className="space-y-2">
        <input aria-label="Server access token" type="password" placeholder="Server access token (for remote access)" className={field} value={accessToken} onChange={e => { setAccessToken(e.target.value); sessionStorage.setItem('harness-access-token', e.target.value); }} />
        <p className="text-[10px] text-[var(--ide-muted)]">Keys are kept on the server in GEMINI_API_KEY and OPENROUTER_API_KEY. Local models use OLLAMA_BASE_URL. No automatic provider fallback.</p>
      </div>}
    </div>
    <div role="log" aria-label="Harness activity" className="ide-agent-log min-h-0 flex-1 overflow-auto space-y-3">
      {!events.length && <div className="agent-onboarding">
        <div className="agent-emblem"><Bot size={24} aria-hidden="true" /></div>
        <p className="agent-eyebrow">A LITTLE HELP GOES A LONG WAY</p>
        <h2>What are we building?</h2>
        <p>Explore your code, work through a tricky bug, or turn an idea into something real.</p>
        <div className="agent-suggestions">{[
          ['Explore this project', 'Inspect the workspace and summarize its architecture. Then suggest the most useful next improvement.'],
          ['Find a bug', 'Review the workspace for bugs and edge cases. Explain the problem and propose a focused fix.'],
          ['Plan a feature', 'Help me plan a feature for this project. First inspect the existing architecture and ask what I want to build.'],
        ].map(([label, value]) => <button key={label} disabled={busy || remoteBusy} onClick={() => { setPrompt(value); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.ide-agent textarea')?.focus()); }}><span>{label}</span><ArrowUpRight size={13} aria-hidden="true" /></button>)}</div>
      </div>}
      {events.map((e, i) => <div key={e.id || i} className={`rounded p-2.5 text-xs leading-5 ${e.type === 'user' ? 'bg-[var(--ide-selected)]' : e.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-[var(--ide-panel)]'}`}>
        {e.author && <div className="mb-1 text-[10px] text-[var(--ide-accent)]">{e.author}</div>}
        {e.type === 'tool' ? <details open={e.status === 'running'}><summary className="cursor-pointer font-mono">{e.status === 'running' ? 'Working' : e.status === 'failed' ? 'Failed' : 'Done'} · {e.name}</summary><pre className="whitespace-pre-wrap break-all text-[10px] max-h-52 overflow-auto">{e.result || e.arguments}</pre></details>
          : <div className="whitespace-pre-wrap break-words">{e.type === 'file' && <FileCode size={13} className="inline mr-1" />}{e.content || e.message || (e.type === 'done' ? 'Run complete.' : '')}</div>}
      </div>)}
      {conflicts.map((e, i) => <button key={i} onClick={() => download(e)} className="flex gap-2 text-xs text-amber-400"><Download size={14} />Download proposed {e.path}</button>)}
      <div ref={bottomRef} />
    </div>
    {approval && <div className="m-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs"><strong>Command approval</strong><pre className="my-2 whitespace-pre-wrap break-all">{approval}</pre><p className="mb-2 text-[10px]">This command runs on the server with its user's permissions.</p><div className="flex gap-2"><button onClick={() => void decide(true)} className="rounded bg-amber-500 px-3 py-1 text-black">Run command</button><button onClick={() => void decide(false)} className="rounded border border-[var(--ide-border)] px-3 py-1">Deny</button></div></div>}
    {error && <p role="alert" className="px-3 pb-2 text-xs text-red-400">{error}</p>}
    {remoteBusy && <p className="px-3 pb-2 text-xs text-[var(--ide-accent)]">Your collaborator is running the harness…</p>}
    <form className="border-t border-[var(--ide-border)] p-3" onSubmit={e => { e.preventDefault(); void start(); }}>
      <textarea aria-label="Ask Skippy" className={`${field} min-h-20 resize-none`} placeholder="Ask Skippy to build, fix, or explain…" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(); } }} />
      <div className="mt-2 flex items-center justify-between"><button type="button" disabled={busy || remoteBusy} className="text-[10px] text-[var(--ide-muted)]" onClick={() => { setHistory([]); setEvents([]); }}>New conversation</button>
        {busy ? <button type="button" onClick={() => { abortRef.current?.abort(); if (runRef.current) void cancelRun(runRef.current.id, runRef.current.token); }} className="flex items-center gap-1 rounded bg-red-500/15 px-3 py-2 text-xs text-red-400"><Square size={12} />Stop</button>
        : <button disabled={!prompt.trim() || !model || remoteBusy} className="flex items-center gap-2 rounded bg-[var(--ide-selected)] px-3 py-2 text-xs font-medium text-[var(--ide-accent)] disabled:opacity-40"><Send size={13} />Send</button>}</div>
    </form>
  </section>;
};
