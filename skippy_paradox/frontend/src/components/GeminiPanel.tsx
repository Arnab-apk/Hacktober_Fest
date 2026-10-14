import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Sparkles, Loader2, Trash2,
  RotateCcw, Plus, ChevronDown, Square, X, Bot, CheckCircle2, Wrench,
} from 'lucide-react';
import { marked } from 'marked';
import { useTheme } from '../hooks/useTheme';
import { StoredFile } from '../services/storageService';
import { geminiKeyRotation } from '../services/geminiKeyRotation';
import { runAgentLoop, AgentStep } from '../services/agentService';

/* ── Types ─────────────────────────────────────────────────────────── */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
  timestamp: number;
  steps?: AgentStep[];
}

interface Conversation {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface GeminiPanelProps {
  activeFile: StoredFile | null;
  allFiles?: StoredFile[];
  onCodeChange?: (fileId: string, content: string) => void;
  onFileCreate?: () => void;
  onAgentFileCreate?: (name: string, content: string, language?: string) => void;
}

/* ── Constants ─────────────────────────────────────────────────────── */

const GEMINI_API_KEY_STORAGE = 'gemini-api-key';
const OPENROUTER_API_KEY_STORAGE = 'openrouter-api-key';
const PROVIDER_STORAGE = 'agent-provider-choice';
const MODEL_STORAGE = 'agent-model-choice';
const AGENT_MODE_STORAGE = 'agent-autonomous-mode';
const CONVERSATIONS_STORAGE = 'gemini-conversations';
const ACTIVE_CONV_STORAGE = 'gemini-active-conv';
const MAX_HISTORY_MESSAGES = 10;
const MAX_FILE_CONTEXT_CHARS = 12000;
const MAX_CONVERSATIONS = 20;

const QUICK_ACTIONS = [
  { label: 'Fix bugs', prompt: 'Inspect all workspace files, find and fix bugs, and execute to verify.' },
  { label: 'Add unit tests', prompt: 'Create unit tests for the current code in a new file and execute them.' },
  { label: 'Optimize', prompt: 'Analyze performance, refactor for efficiency, and test the output.' },
  { label: 'Agent plan', prompt: 'List all files, summarize current architecture, and plan next features.' },
];

/* ── Configure marked ──────────────────────────────────────────────── */

marked.setOptions({
  gfm: true,
  breaks: true,
});

/* ── Conversation persistence ──────────────────────────────────────── */

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConversations(convs: Conversation[]) {
  try {
    localStorage.setItem(CONVERSATIONS_STORAGE, JSON.stringify(convs.slice(0, MAX_CONVERSATIONS)));
  } catch { /* quota exceeded — silently fail */ }
}

function loadActiveConvId(): string | null {
  return localStorage.getItem(ACTIVE_CONV_STORAGE);
}

function saveActiveConvId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_CONV_STORAGE, id);
  else localStorage.removeItem(ACTIVE_CONV_STORAGE);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createConversation(): Conversation {
  return {
    id: newId(),
    name: 'New chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ── Markdown renderer ─────────────────────────────────────────────── */

function RenderedMarkdown({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = React.useMemo(() => {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }, [content]);

  useEffect(() => {
    if (!containerRef.current) return;
    const pres = containerRef.current.querySelectorAll('pre');
    pres.forEach((pre) => {
      if (pre.querySelector('.code-copy-btn')) return;
      pre.style.position = 'relative';
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn absolute top-2 right-2 p-1 rounded bg-white/10 hover:bg-white/20 transition-colors text-slate-400 hover:text-slate-200 text-[10px]';
      btn.textContent = 'Copy';
      btn.onclick = () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent || '';
        navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      };
      pre.appendChild(btn);
    });

    const links = containerRef.current.querySelectorAll('a');
    links.forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="ai-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ── Message bubble ────────────────────────────────────────────────── */

function MessageBubble({ msg, isStreaming }: { msg: Message; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const isUser = msg.role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3`}>
      {!isUser && (
        <div className="flex items-center gap-1.5 mb-1 mx-1">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Bot size={9} className="text-white" />
          </div>
          <span className={`text-[10px] font-bold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>Skiff Agent</span>
        </div>
      )}

      {/* Agent Tool Execution Steps */}
      {!isUser && msg.steps && msg.steps.length > 0 && (
        <div className="w-full max-w-[95%] mb-2 space-y-1">
          {msg.steps.map((st) => (
            <div
              key={st.id}
              className={`text-[10px] px-2.5 py-1.5 rounded-md border flex items-center justify-between font-mono ${
                st.status === 'running'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : st.status === 'failed'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : isDark
                  ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-700'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                {st.status === 'running' ? (
                  <Loader2 size={11} className="animate-spin text-amber-400 shrink-0" />
                ) : st.status === 'failed' ? (
                  <X size={11} className="text-red-400 shrink-0" />
                ) : (
                  <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                )}
                <span className="truncate">{st.title}</span>
              </div>
              <span className="text-[9px] opacity-60 ml-2">
                {st.type === 'tool_call' ? 'tool' : st.type === 'tool_result' ? 'success' : 'done'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        className={`px-3 py-2 rounded-lg text-[12px] max-w-[92%] leading-relaxed overflow-hidden ${
          isUser
            ? 'bg-[#CAA4F7] text-[#1E1E2A] rounded-tr-sm font-medium'
            : isDark
              ? 'bg-[#232340] text-slate-200 rounded-tl-sm border border-slate-700/50 shadow-sm'
              : 'bg-white text-slate-800 border border-slate-200/60 rounded-tl-sm shadow-sm'
        }`}
      >
        {msg.loading && !msg.content ? (
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-purple-400" />
            <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Agent inspecting files & executing tools...</span>
          </div>
        ) : isUser ? (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        ) : (
          <>
            <RenderedMarkdown content={msg.content} />
            {isStreaming && (
              <span className="inline-block w-[2px] h-[14px] bg-purple-400 ml-0.5 align-middle animate-blink-cursor" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Conversation dropdown ─────────────────────────────────────────── */

function ConversationDropdown({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  isDark,
}: {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
          isDark ? 'hover:bg-slate-700/50 text-slate-400' : 'hover:bg-slate-200 text-slate-500'
        }`}
      >
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        <span>History</span>
      </button>

      {open && (
        <div
          className={`absolute top-full left-0 mt-1 w-56 rounded-lg shadow-xl border z-50 overflow-hidden ${
            isDark ? 'bg-[#1a1a2e] border-slate-700/50' : 'bg-white border-slate-200'
          }`}
        >
          <button
            onClick={() => { onNew(); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium transition-colors ${
              isDark ? 'text-purple-400 hover:bg-purple-500/10' : 'text-purple-600 hover:bg-purple-50'
            }`}
          >
            <Plus size={12} /> New chat
          </button>

          <div className={`border-t ${isDark ? 'border-slate-700/40' : 'border-slate-100'}`} />

          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {sorted.length === 0 && (
              <div className={`px-3 py-3 text-[10px] text-center ${textMuted}`}>No conversations yet</div>
            )}
            {sorted.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  conv.id === activeId
                    ? isDark ? 'bg-purple-500/10' : 'bg-purple-50'
                    : isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                }`}
                onClick={() => { onSelect(conv.id); setOpen(false); }}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-[11px] truncate ${
                    conv.id === activeId
                      ? 'text-purple-400 font-medium'
                      : isDark ? 'text-slate-300' : 'text-slate-700'
                  }`}>
                    {conv.name}
                  </div>
                  <div className={`text-[9px] ${textMuted}`}>
                    {conv.messages.length} msgs · {relativeTime(conv.updatedAt)}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                  className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all ${textMuted} hover:text-red-400 hover:bg-red-500/10`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const GeminiPanel: React.FC<GeminiPanelProps> = ({
  activeFile,
  allFiles,
  onCodeChange,
  onFileCreate,
  onAgentFileCreate,
}) => {
  const { isDark } = useTheme();

  // Agent Harness & Provider state
  const [provider, setProvider] = useState<'gemini' | 'openrouter'>(() => {
    return 'openrouter';
  });
  const [model, setModel] = useState<string>(() => {
    const saved = localStorage.getItem(MODEL_STORAGE);
    if (!saved || saved.toLowerCase().includes('claude') || saved.toLowerCase().includes('sonnet') || saved.toLowerCase().includes('gpt-4')) {
      localStorage.setItem(MODEL_STORAGE, 'nvidia/nemotron-3.5-lightning:free');
      return 'nvidia/nemotron-3.5-lightning:free';
    }
    return saved;
  });
  const [isAgentHarness, setIsAgentHarness] = useState<boolean>(() => {
    return localStorage.getItem(AGENT_MODE_STORAGE) !== 'false';
  });
  const [openRouterKey, setOpenRouterKey] = useState<string>(() => {
    const key = localStorage.getItem(OPENROUTER_API_KEY_STORAGE);
    const envKey = (import.meta as any).env?.VITE_OPENROUTER_API_KEY || '';
    if (key && key.startsWith('sk-or-')) return key;
    if (envKey) {
      localStorage.setItem(OPENROUTER_API_KEY_STORAGE, envKey);
      return envKey;
    }
    return '';
  });
  const [geminiCustomKey, setGeminiCustomKey] = useState<string>(() => {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
  });
  const [showConfigModal, setShowConfigModal] = useState(false);

  useEffect(() => {
    // Sanitize any stale or paid models if on OpenRouter
    const savedModel = localStorage.getItem(MODEL_STORAGE);
    if (!savedModel || savedModel.toLowerCase().includes('claude') || savedModel.toLowerCase().includes('sonnet') || savedModel.toLowerCase().includes('gpt-4')) {
      setModel('nvidia/nemotron-3.5-lightning:free');
      localStorage.setItem(MODEL_STORAGE, 'nvidia/nemotron-3.5-lightning:free');
    }
  }, []);

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeConvId, setActiveConvId] = useState<string | null>(loadActiveConvId);
  const [messages, setMessages] = useState<Message[]>([]);

  // UI state
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [keyStats, setKeyStats] = useState(geminiKeyRotation.getUsageStats());

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgId = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(PROVIDER_STORAGE, provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE, model);
  }, [model]);

  useEffect(() => {
    localStorage.setItem(AGENT_MODE_STORAGE, String(isAgentHarness));
  }, [isAgentHarness]);

  useEffect(() => {
    if (openRouterKey) localStorage.setItem(OPENROUTER_API_KEY_STORAGE, openRouterKey);
    else localStorage.removeItem(OPENROUTER_API_KEY_STORAGE);
  }, [openRouterKey]);

  useEffect(() => {
    if (geminiCustomKey) {
      localStorage.setItem(GEMINI_API_KEY_STORAGE, geminiCustomKey);
      geminiKeyRotation.setCustomKey(geminiCustomKey);
    } else {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    }
  }, [geminiCustomKey]);

  /* ── Initialize conversation ───────────────────────────────────── */

  useEffect(() => {
    const convs = loadConversations();
    setConversations(convs);

    let id = loadActiveConvId();
    if (id && convs.find((c) => c.id === id)) {
      setMessages(convs.find((c) => c.id === id)!.messages);
    } else {
      const conv = createConversation();
      const updated = [conv, ...convs].slice(0, MAX_CONVERSATIONS);
      saveConversations(updated);
      saveActiveConvId(conv.id);
      setConversations(updated);
      setActiveConvId(conv.id);
      id = conv.id;
    }
    setActiveConvId(id);
  }, []);

  /* ── Persist messages on change ────────────────────────────────── */

  const persistConversation = useCallback((msgs: Message[]) => {
    if (!activeConvId) return;
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === activeConvId
          ? { ...c, messages: msgs, updatedAt: Date.now() }
          : c
      );
      saveConversations(updated);
      return updated;
    });
  }, [activeConvId]);

  /* ── Auto-scroll ───────────────────────────────────────────────── */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── Block wheel ───────────────────────────────────────────────── */

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  /* ── Build Gemini request ──────────────────────────────────────── */

  const buildContext = useCallback(() => {
    if (!activeFile) return '';
    const lang = activeFile.language || 'plaintext';
    const full = activeFile.content || '';
    const content = full.length > MAX_FILE_CONTEXT_CHARS
      ? `${full.slice(0, MAX_FILE_CONTEXT_CHARS)}\n\n[Truncated]`
      : full;
    return `\`\`\`${lang}\n// File: ${activeFile.name}\n${content}\n\`\`\``;
  }, [activeFile]);

  const buildContents = useCallback((userText: string) => {
    const history = messages
      .filter((m) => !m.loading && m.content.trim())
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: m.content }],
      }));

    const context = buildContext();
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    if (context) {
      contents.push({
        role: 'user',
        parts: [{ text: `You are an expert coding assistant in Skiffy. Use this file context when relevant:\n\n${context}` }],
      });
    }

    contents.push(...history);
    contents.push({ role: 'user', parts: [{ text: userText }] });
    return contents;
  }, [buildContext, messages]);

  /* ── Streaming send ────────────────────────────────────────────── */

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || isLoading) return;

    const effectiveKey = provider === 'openrouter'
      ? (openRouterKey || localStorage.getItem(OPENROUTER_API_KEY_STORAGE))
      : (localStorage.getItem(GEMINI_API_KEY_STORAGE) || geminiKeyRotation.getCurrentKey());

    if (!effectiveKey) {
      setShowConfigModal(true);
      const errMsg: Message = {
        id: newId(),
        role: 'assistant',
        content: provider === 'openrouter'
          ? '🔑 Please paste your OpenRouter API key in the configuration drawer above to start.'
          : '🔑 Please paste your Gemini API key in the configuration drawer above to start.',
        timestamp: Date.now(),
      };
      const next = [...messages, errMsg];
      setMessages(next);
      persistConversation(next);
      return;
    }

    const userMsg: Message = { id: newId(), role: 'user', content: userText, timestamp: Date.now() };
    const assistantMsg: Message = {
      id: newId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      steps: [],
    };

    streamingMsgId.current = assistantMsg.id;
    const withUserMsg = [...messages, userMsg, assistantMsg];
    setMessages(withUserMsg);
    setInput('');
    setIsLoading(true);

    if (activeConvId) {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === activeConvId);
        if (conv && conv.name === 'New chat' && conv.messages.length === 0) {
          const name = userText.slice(0, 40) + (userText.length > 40 ? '...' : '');
          const updated = prev.map((c) => c.id === activeConvId ? { ...c, name } : c);
          saveConversations(updated);
          return updated;
        }
        return prev;
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // ── Autonomous Agent Harness Execution ──
    if (isAgentHarness) {
      try {
        const finalAnswer = await runAgentLoop({
          prompt: userText,
          apiKey: effectiveKey,
          provider,
          model,
          signal: controller.signal,
          currentFiles: allFiles,
          callbacks: {
            onStep: (step) => {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  const currentSteps = m.steps || [];
                  const existingIdx = currentSteps.findIndex((s) => s.id === step.id);
                  let newSteps = [...currentSteps];
                  if (existingIdx >= 0) {
                    newSteps[existingIdx] = step;
                  } else {
                    newSteps.push(step);
                  }
                  return { ...m, steps: newSteps };
                })
              );
            },
            onUpdateFile: (fileId, content) => {
              if (onCodeChange) onCodeChange(fileId, content);
            },
            onCreateFile: (name, content, language) => {
              if (onAgentFileCreate) {
                onAgentFileCreate(name, content, language);
              } else if (onFileCreate) {
                (onFileCreate as any)(name, content, language);
              }
            },
            onSaveFile: (file) => {
              if (onAgentFileCreate) {
                onAgentFileCreate(file.name, file.content, file.language);
              }
            },
          },
        });

        if (provider === 'gemini' && !localStorage.getItem(GEMINI_API_KEY_STORAGE)) {
          geminiKeyRotation.recordUsage();
          setKeyStats(geminiKeyRotation.getUsageStats());
        }

        setMessages((prev) => {
          const final = prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: finalAnswer, loading: false }
              : m
          );
          persistConversation(final);
          return final;
        });
      } catch (err: any) {
        setMessages((prev) => {
          const final = prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `Agent error: ${err.message}`, loading: false }
              : m
          );
          persistConversation(final);
          return final;
        });
      } finally {
        setIsLoading(false);
        streamingMsgId.current = null;
        abortRef.current = null;
      }
      return;
    }

    const requestContents = buildContents(userText);
    let accumulated = '';

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${effectiveKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: requestContents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              accumulated += text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: accumulated, loading: true } : m
                )
              );
            }
          } catch { /* skip malformed chunk */ }
        }
      }

      if (!localStorage.getItem(GEMINI_API_KEY_STORAGE)) {
        geminiKeyRotation.recordUsage();
        setKeyStats(geminiKeyRotation.getUsageStats());
      }

      setMessages((prev) => {
        const final = prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: accumulated || 'No response received.', loading: false }
            : m
        );
        persistConversation(final);
        return final;
      });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setMessages((prev) => {
          const final = prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, loading: false } : m
          );
          persistConversation(final);
          return final;
        });
      } else {
        setMessages((prev) => {
          const final = prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `Error: ${e.message}`, loading: false }
              : m
          );
          persistConversation(final);
          return final;
        });
      }
    } finally {
      setIsLoading(false);
      streamingMsgId.current = null;
      abortRef.current = null;
    }
  }, [isLoading, messages, buildContents, persistConversation, activeConvId]);

  /* ── Stop streaming ────────────────────────────────────────────── */

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ── Conversation management ───────────────────────────────────── */

  const switchConversation = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setActiveConvId(id);
    saveActiveConvId(id);
    setMessages(conv.messages);
  }, [conversations]);

  const startNewConversation = useCallback(() => {
    const conv = createConversation();
    const updated = [conv, ...conversations].slice(0, MAX_CONVERSATIONS);
    saveConversations(updated);
    saveActiveConvId(conv.id);
    setConversations(updated);
    setActiveConvId(conv.id);
    setMessages([]);
  }, [conversations]);

  const deleteConversation = useCallback((id: string) => {
    const updated = conversations.filter((c) => c.id !== id);
    saveConversations(updated);
    setConversations(updated);

    if (id === activeConvId) {
      if (updated.length > 0) {
        switchConversation(updated[0].id);
      } else {
        startNewConversation();
      }
    }
  }, [conversations, activeConvId, switchConversation, startNewConversation]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    persistConversation([]);
  }, [persistConversation]);

  /* ── Form handlers ─────────────────────────────────────────────── */

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  /* ── Theme ─────────────────────────────────────────────────────── */

  const bg = isDark ? 'bg-[#1E1E2A]' : 'bg-[#F0F2F6]';
  const border = isDark ? 'border-slate-700/40' : 'border-slate-300/40';
  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDark ? 'bg-[#232340] border-slate-600/40' : 'bg-white border-slate-300';

  return (
    <div className={`flex flex-col h-full w-full ${bg} overflow-hidden`}>
      {/* Header */}
      <div className={`flex flex-col px-3 py-2.5 border-b ${border} shrink-0`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Bot size={9} className="text-white" />
            </div>
            <span className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
              Skiff Agent
            </span>

            {/* Autonomous Mode Toggle */}
            <button
              onClick={() => setIsAgentHarness(!isAgentHarness)}
              className={`text-[9px] px-2 py-0.5 rounded-full font-bold transition-all ${
                isAgentHarness
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : isDark ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-slate-200 text-slate-600'
              }`}
              title="Toggle Autonomous Tool Calling Loop"
            >
              {isAgentHarness ? '⚡ Autonomous' : '💬 Chat Only'}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <ConversationDropdown
              conversations={conversations}
              activeId={activeConvId || ''}
              onSelect={switchConversation}
              onNew={startNewConversation}
              onDelete={deleteConversation}
              isDark={isDark}
            />
            <button
              onClick={() => setShowConfigModal(!showConfigModal)}
              className={`p-1 rounded-md ${textMuted} hover:text-purple-400 hover:bg-purple-500/10 transition-colors`}
              title="Agent & Model Settings"
            >
              <Wrench size={12} />
            </button>
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className={`p-1 rounded-md ${textMuted} hover:text-red-400 hover:bg-red-500/10 transition-colors`}
                title="Clear chat"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Model + Provider + key stats */}
        <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold shrink-0 ${isDark ? 'bg-purple-950/50 border border-purple-500/40 text-purple-300' : 'bg-purple-100 text-purple-800'}`}>
              {provider.toUpperCase()}
            </span>
            {provider === 'openrouter' ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border truncate cursor-pointer ${
                  isDark ? 'bg-[#181828] border-slate-700 text-purple-300' : 'bg-white border-slate-200 text-purple-700'
                } focus:outline-none focus:ring-1 focus:ring-purple-500`}
                title="Select OpenRouter Model"
              >
                <option value="nvidia/nemotron-3.5-lightning:free">⚡ Nemotron 3.5 Lightning (Free)</option>
                <option value="meta-llama/llama-3.3-70b-instruct:free">🦙 Llama 3.3 70B (Free)</option>
                <option value="qwen/qwen-2.5-coder-32b-instruct:free">💻 Qwen 2.5 Coder (Free)</option>
                <option value="google/gemini-2.0-flash-exp:free">✨ Gemini 2.0 Flash Exp (Free)</option>
                <option value="deepseek/deepseek-r1:free">🧠 DeepSeek R1 (Free)</option>
              </select>
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border truncate cursor-pointer ${
                  isDark ? 'bg-[#181828] border-slate-700 text-purple-300' : 'bg-white border-slate-200 text-purple-700'
                } focus:outline-none focus:ring-1 focus:ring-purple-500`}
                title="Select Gemini Model"
              >
                <option value="gemini-2.0-flash">⚡ Gemini 2.0 Flash</option>
                <option value="gemini-1.5-pro">🧠 Gemini 1.5 Pro</option>
                <option value="gemini-2.5-pro-exp">🚀 Gemini 2.5 Pro Exp</option>
              </select>
            )}
          </div>

          {!localStorage.getItem(GEMINI_API_KEY_STORAGE) && provider === 'gemini' && geminiKeyRotation.hasKeys() && (
            <div className="flex items-center gap-1">
              {keyStats.map((stat) => (
                <span
                  key={stat.keyIndex}
                  className={`text-[8px] px-1 py-0.5 rounded font-mono ${
                    stat.isCurrent
                      ? 'bg-purple-500/15 text-purple-400'
                      : isDark ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  K{stat.keyIndex}:{stat.usage}
                </span>
              ))}
              <button
                onClick={() => { geminiKeyRotation.resetUsage(); setKeyStats(geminiKeyRotation.getUsageStats()); }}
                className={`p-0.5 rounded ${textMuted} hover:text-purple-400 transition-colors`}
                title="Reset key usage"
              >
                <RotateCcw size={9} />
              </button>
            </div>
          )}
        </div>

        {/* Config Modal Inline Drawer */}
        {showConfigModal && (
          <div className={`mt-2 p-2.5 rounded-lg border text-[11px] space-y-2 ${isDark ? 'bg-[#1a1a2e] border-slate-700' : 'bg-white border-slate-300'}`}>
            <div className="font-semibold text-purple-400">Agent Configuration</div>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="provider"
                  checked={provider === 'gemini'}
                  onChange={() => { setProvider('gemini'); setModel('gemini-2.0-flash'); }}
                />
                Gemini
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="provider"
                  checked={provider === 'openrouter'}
                  onChange={() => { setProvider('openrouter'); setModel('nvidia/nemotron-3.5-lightning:free'); }}
                />
                OpenRouter
              </label>
            </div>

            {provider === 'openrouter' && (
              <div className="space-y-1.5">
                <input
                  type="password"
                  placeholder="Paste OpenRouter API Key"
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  className={`w-full px-2 py-1 rounded border text-[10px] ${inputBg} ${textPrimary}`}
                />
                <input
                  type="text"
                  placeholder="Model name"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={`w-full px-2 py-1 rounded border text-[10px] ${inputBg} ${textPrimary}`}
                />
                <div className="flex gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setModel('nvidia/nemotron-3.5-lightning:free')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${model === 'nvidia/nemotron-3.5-lightning:free' ? 'bg-purple-600 text-white' : 'bg-slate-700/40 text-slate-300'}`}
                  >
                    Nemotron 3.5 Lightning (Free)
                  </button>
                  <button
                    type="button"
                    onClick={() => setModel('nvidia/nemotron-3-ultra-550b-a55b:free')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${model === 'nvidia/nemotron-3-ultra-550b-a55b:free' ? 'bg-purple-600 text-white' : 'bg-slate-700/40 text-slate-300'}`}
                  >
                    Nemotron 3 Ultra (Free)
                  </button>
                  <button
                    type="button"
                    onClick={() => setModel('nvidia/nemotron-3-super-120b-a12b:free')}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${model === 'nvidia/nemotron-3-super-120b-a12b:free' ? 'bg-purple-600 text-white' : 'bg-slate-700/40 text-slate-300'}`}
                  >
                    Nemotron 3 Super (Free)
                  </button>
                </div>
              </div>
            )}

            {provider === 'gemini' && (
              <div className="space-y-1.5">
                <input
                  type="password"
                  placeholder="Paste Gemini API Key (Pro account key)"
                  value={geminiCustomKey}
                  onChange={(e) => setGeminiCustomKey(e.target.value)}
                  className={`w-full px-2 py-1 rounded border text-[10px] ${inputBg} ${textPrimary}`}
                />
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={`w-full px-2 py-1 rounded border text-[10px] ${inputBg} ${textPrimary}`}
                >
                  <option value="gemini-2.0-flash">gemini-2.0-flash (Fast & Accurate)</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro (Deep Reasoning)</option>
                  <option value="gemini-2.5-pro-exp">gemini-2.5-pro-exp (Top Coding)</option>
                </select>
              </div>
            )}

            <button
              onClick={() => setShowConfigModal(false)}
              className="w-full py-1 rounded bg-purple-600 text-white font-medium text-[10px]"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Quick actions — only when empty */}
      {messages.length === 0 && (
        <div className={`px-3 py-2 border-b ${border} shrink-0`}>
          <div className="flex flex-wrap gap-1">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => sendMessage(action.prompt)}
                disabled={isLoading || !activeFile}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all active:scale-95 disabled:opacity-30 ${
                  isDark
                    ? 'bg-[#232340] hover:bg-[#2a2a50] text-slate-300 border border-slate-700/40'
                    : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
          {!activeFile && (
            <p className={`text-[9px] mt-1 ${textMuted} opacity-50`}>Open a file to use quick actions</p>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="h-full overflow-y-auto scrollbar-hide p-3 space-y-2.5"
        >
          {messages.length === 0 && (
            <div className={`flex flex-col items-center justify-center h-full ${textMuted}`}>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/15 to-purple-600/15 flex items-center justify-center mb-2">
                <Sparkles size={16} className="text-purple-400" />
              </div>
              <p className="text-[11px] font-medium">Ask AI anything</p>
              <p className="text-[10px] mt-0.5 opacity-40">Analyze, fix, or improve your code</p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isStreaming={msg.loading && msg.id === streamingMsgId.current && msg.content.length > 0}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className={`p-2.5 border-t ${border} shrink-0`}>
        {isLoading && (
          <button
            onClick={stopStreaming}
            className={`w-full flex items-center justify-center gap-1.5 mb-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
              isDark
                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : 'bg-red-50 text-red-500 hover:bg-red-100'
            }`}
          >
            <Square size={10} /> Stop generating
          </button>
        )}
        <form onSubmit={handleSubmit} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeFile ? `Ask about ${activeFile.name}...` : 'Ask AI...'}
            className={`w-full pl-3 pr-9 py-2 rounded-lg text-[12px] focus:outline-none transition-colors border ${inputBg} ${textPrimary} placeholder:text-slate-400/50 focus:ring-1 focus:ring-[#CAA4F7]/40 focus:border-[#CAA4F7]/40`}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors ${
              !input.trim() || isLoading
                ? 'opacity-20 cursor-not-allowed'
                : 'text-[#CAA4F7] hover:bg-[#CAA4F7]/10'
            }`}
          >
            {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </form>
      </div>
    </div>
  );
};
