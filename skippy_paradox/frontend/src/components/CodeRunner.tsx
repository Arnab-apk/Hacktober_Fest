/**
 * CodeRunner — Authentic, sleek terminal UI for running code via OnlineCompiler / Backend API.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Loader2,
  Terminal as TerminalIcon,
  Check,
  Copy,
  Trash2,
  CornerDownLeft,
  X,
  Clock,
  Cpu,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { executeCode, mapMonacoLanguageToJudge0, ExecutionResult } from '../services/judge0Service';
import { inferLanguageFromSnippet } from '../utils/detectLanguage';

export const SUPPORTED_RUNNER_LANGS = [
  'Python',
  'JavaScript',
  'TypeScript',
  'C++',
  'C',
  'Java',
  'Go',
  'Rust',
  'Ruby',
  'PHP',
  'C#',
  'Bash',
  'SQL',
];

interface CodeRunnerProps {
  code: string;
  language: string;
  fileName: string;
  onClose?: () => void;
  triggerRun?: boolean;
  onRunHandled?: () => void;
  onLanguageChange?: (language: string) => void;
}

interface TerminalSession {
  id: string;
  timestamp: string;
  command: string;
  result?: ExecutionResult;
  error?: string;
}

const getCommandForLanguage = (language: string, fileName: string): string => {
  const lang = (language || '').toLowerCase();
  const name = fileName || 'script';
  if (lang.includes('python')) return `python3 ${name}`;
  if (lang.includes('javascript') || lang === 'js' || lang === 'node') return `node ${name}`;
  if (lang.includes('typescript') || lang === 'ts') return `deno run ${name}`;
  if (lang.includes('cpp') || lang.includes('c++')) return `g++ -O2 ${name} && ./a.out`;
  if (lang === 'c') return `gcc -O2 ${name} && ./a.out`;
  if (lang.includes('java')) return `javac ${name} && java Main`;
  if (lang.includes('go')) return `go run ${name}`;
  if (lang.includes('rust')) return `rustc ${name} && ./main`;
  if (lang.includes('ruby')) return `ruby ${name}`;
  if (lang.includes('php')) return `php ${name}`;
  if (lang.includes('csharp') || lang.includes('c#')) return `dotnet run ${name}`;
  return `run ${name}`;
};

export const CodeRunner: React.FC<CodeRunnerProps> = ({
  code,
  language,
  fileName,
  onClose,
  onLanguageChange,
  triggerRun = false,
  onRunHandled,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<TerminalSession[]>([]);
  const [currentRunningCmd, setCurrentRunningCmd] = useState<string | null>(null);
  const [stdin, setStdin] = useState('');
  const [showStdin, setShowStdin] = useState(false);
  const [copied, setCopied] = useState(false);
  const handledRunRef = useRef(false);
  const terminalBottomRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const detected = inferLanguageFromSnippet(code);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    language || detected || 'Python'
  );

  useEffect(() => {
    if (language) {
      setSelectedLanguage(language);
    } else if (detected) {
      setSelectedLanguage(detected);
    }
  }, [language, detected]);

  // Auto-scroll to bottom when new terminal output arrives
  useEffect(() => {
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, isRunning]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;

    const activeLang = selectedLanguage || language || detected || 'Python';
    const trimmedCode = code.trim();
    const command = getCommandForLanguage(activeLang, fileName);
    const timeStr = new Date().toLocaleTimeString([], { hour12: false });
    const sessionId = Date.now().toString();

    if (!trimmedCode) {
      setHistory((prev) => [
        ...prev,
        {
          id: sessionId,
          timestamp: timeStr,
          command,
          error: 'Error: Cannot execute empty source file. Write some code first.',
        },
      ]);
      return;
    }

    setIsRunning(true);
    setCurrentRunningCmd(command);

    try {
      let effectiveLang = activeLang;
      if (/^\s*(def |import |from |print\(|class .*?:|if __name__)/m.test(code) && !/console\.log|const |let |var |function /m.test(code)) {
        effectiveLang = 'Python';
      }
      const judge0Lang = mapMonacoLanguageToJudge0(effectiveLang);
      const executionResult = await executeCode({
        source_code: code,
        language: judge0Lang,
        stdin: stdin || undefined,
      });

      setHistory((prev) => [
        ...prev,
        {
          id: sessionId,
          timestamp: timeStr,
          command,
          result: executionResult,
        },
      ]);
    } catch (e: any) {
      const msg = e?.message || 'Execution failed';
      let friendlyError = msg;
      if (msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        friendlyError =
          'Network Error: Could not connect to API server. Ensure the backend server is running and accessible.';
      }

      setHistory((prev) => [
        ...prev,
        {
          id: sessionId,
          timestamp: timeStr,
          command,
          error: friendlyError,
        },
      ]);
    } finally {
      setIsRunning(false);
      setCurrentRunningCmd(null);
    }
  }, [code, language, fileName, stdin, isRunning, selectedLanguage, detected]);

  // A workspace run request also opens a closed output dock.
  useEffect(() => {
    if (!triggerRun) { handledRunRef.current = false; return; }
    if (handledRunRef.current) return;
    handledRunRef.current = true;
    void handleRun();
    onRunHandled?.();
  }, [triggerRun, handleRun, onRunHandled]);

  const handleClear = () => {
    setHistory([]);
  };

  const handleCopy = async () => {
    if (history.length === 0) return;
    const textToCopy = history
      .map((item) => {
        let text = `$ ${item.command}\n`;
        if (item.error) text += `[ERROR] ${item.error}\n`;
        if (item.result?.compile_output) text += `[COMPILATION ERROR]\n${item.result.compile_output}\n`;
        if (item.result?.stdout) text += item.result.stdout;
        if (item.result?.stderr) text += `[STDERR]\n${item.result.stderr}\n`;
        if (item.result?.status) text += `[Status: ${item.result.status.description}]\n`;
        return text;
      })
      .join('\n───────────────────────\n\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy terminal output:', err);
    }
  };

  const lastSession = history.length > 0 ? history[history.length - 1] : null;
  const lastResult = lastSession?.result;
  const isAccepted = lastResult?.status?.id === 3;

  return (
    <div className="ide-runner flex flex-col h-full select-text overflow-hidden font-sans">
      {/* ── Terminal Window Titlebar ── */}
      <div className="ide-runner-title">
        {/* Left: Window Controls + Tab */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--ide-bg)] border border-[var(--ide-border)] text-[11px] font-mono text-[var(--ide-text)]">
            <TerminalIcon size={12} className="text-[var(--ide-success)]" />
            <span className="font-medium">Output</span>
          </div>

          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--ide-bg)] text-[var(--ide-muted)] hidden sm:inline-block truncate max-w-[130px]">
            {fileName || 'script'}
          </span>
          {/* Language Selector Dropdown */}
          <div className="relative flex items-center">
            <select
              value={selectedLanguage}
              onChange={(e) => {
                const nextLang = e.target.value;
                setSelectedLanguage(nextLang);
                onLanguageChange?.(nextLang);
              }}
              aria-label="Execution Language"
              className="bg-[var(--ide-bg)] hover:bg-[var(--ide-hover)] text-[var(--ide-success)] font-mono text-[10px] pl-2 pr-4 py-0.5 rounded border border-[var(--ide-border)] focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer appearance-none transition-colors"
              title="Execution language"
            >
              {SUPPORTED_RUNNER_LANGS.map((lang) => (
                <option key={lang} value={lang} className="bg-[var(--ide-panel)] text-[var(--ide-text)]">
                  {lang}
                </option>
              ))}
            </select>
            <span className="absolute right-1 pointer-events-none text-[var(--ide-muted)] text-[8px]">▾</span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* STDIN Toggle button */}
          <button
            onClick={() => setShowStdin(!showStdin)}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded font-mono transition-all ${
              showStdin
                ? 'bg-[var(--ide-selected)] text-[var(--ide-accent)] border border-[var(--ide-border)]'
                : 'text-[var(--ide-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-bg)]'
            }`}
            title="Toggle program standard input (stdin)"
          >
            <CornerDownLeft size={11} />
            <span className="hidden sm:inline">STDIN</span>
            {stdin.trim() && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ide-selected)] animate-pulse" />
            )}
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            disabled={history.length === 0}
            className="p-1.5 text-[var(--ide-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-bg)] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Copy terminal output"
          >
            {copied ? <Check size={13} className="text-[var(--ide-success)]" /> : <Copy size={13} />}
          </button>

          {/* Clear Button */}
          <button
            onClick={handleClear}
            disabled={history.length === 0 && !isRunning}
            className="p-1.5 text-[var(--ide-muted)] hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Clear terminal (clear)"
          >
            <Trash2 size={13} />
          </button>

          {/* Run Code Button */}
          <button
            onClick={handleRun}
            disabled={isRunning || !code.trim()}
            className="flex items-center gap-1.5 px-3 py-1 bg-[var(--ide-selected)] text-[var(--ide-accent)] text-white rounded text-xs font-semibold shadow-none transition-all  disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            title="Execute Code (Ctrl + Enter)"
          >
            {isRunning ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play size={12} className="fill-current" />
                <span>Run</span>
                <span className="hidden lg:inline text-[9px] opacity-75 font-mono">^↵</span>
              </>
            )}
          </button>

          {/* Optional close button if parent provides onClose */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--ide-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-bg)] rounded transition-colors ml-1"
              title="Close Panel"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── STDIN Input Drawer ── */}
      {showStdin && (
        <div className="px-3 py-2 bg-[var(--ide-bg)] border-b border-[var(--ide-border)] shrink-0 animate-fade-in">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono font-semibold text-[var(--ide-accent)] flex items-center gap-1">
              <CornerDownLeft size={11} /> STDIN / PROGRAM INPUT
            </span>
            {stdin && (
              <button
                onClick={() => setStdin('')}
                className="text-[10px] text-[var(--ide-muted)] hover:text-[var(--ide-text)] transition-colors"
              >
                Clear input
              </button>
            )}
          </div>
          <textarea
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="Type standard input here (e.g. for input(), scanf(), cin, readline)..."
            rows={3}
            className="w-full px-2.5 py-1.5 rounded bg-[var(--ide-panel)] border border-[var(--ide-border)] text-xs font-mono text-[var(--ide-accent)] placeholder:text-[var(--ide-muted)] focus:outline-none focus:border-[var(--ide-border)] focus:ring-1 focus:ring-[var(--ide-accent)] resize-none custom-scrollbar leading-relaxed"
          />
        </div>
      )}

      {/* ── Terminal Canvas Screen ── */}
      <div
        ref={terminalContainerRef}
        className="flex-1 p-3 overflow-y-auto custom-scrollbar font-mono text-xs leading-relaxed space-y-3 bg-[var(--ide-panel)]"
      >
        {!history.length && <p className="text-[var(--ide-muted)] text-xs">Run the active file to see its output here.</p>}
        {/* History of executed runs */}
        {history.map((session, idx) => {
          const res = session.result;

          return (
            <div key={session.id} className="space-y-1.5 pt-1">
              {/* Command Prompt Line */}
              <div className="flex items-center gap-1.5 text-[var(--ide-text)]">
                <span className="text-[var(--ide-success)] font-semibold select-none">guest@skiffy</span>
                <span className="text-[var(--ide-muted)] select-none">:</span>
                <span className="text-[var(--ide-accent)] font-semibold select-none">~</span>
                <span className="text-[var(--ide-muted)] select-none">$</span>
                <span className="text-[var(--ide-text)] font-medium">{session.command}</span>
                <span className="text-[9px] text-[var(--ide-muted)] ml-auto select-none">{session.timestamp}</span>
              </div>

              {/* Network / Client error */}
              {session.error && (
                <div className="pl-3 border-l-2 border-rose-500 text-rose-400 text-[11px] bg-rose-500/10 py-1.5 px-2 rounded-r">
                  <div className="flex items-center gap-1.5 font-medium mb-0.5">
                    <AlertCircle size={13} />
                    <span>Execution Error</span>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono">{session.error}</pre>
                </div>
              )}

              {/* Compilation Error Output */}
              {res?.compile_output && (
                <div className="pl-3 border-l-2 border-amber-500 text-rose-300 text-[11px] bg-rose-950/20 py-1.5 px-2 rounded-r">
                  <div className="text-amber-400 font-medium text-[10px] mb-1 tracking-wider uppercase flex items-center gap-1">
                    <AlertCircle size={12} />
                    <span>Compilation Error</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-rose-400 font-mono">{res.compile_output}</pre>
                </div>
              )}

              {/* Standard Output (stdout) */}
              {res?.stdout && (
                <div className="pl-3 border-l-2 border-emerald-500/80 text-[var(--ide-success)] py-1 px-1">
                  <pre className="whitespace-pre-wrap font-mono text-[var(--ide-success)] select-text leading-relaxed">
                    {res.stdout}
                  </pre>
                </div>
              )}

              {/* Standard Error (stderr) */}
              {res?.stderr && (
                <div className="pl-3 border-l-2 border-rose-500/80 text-rose-400 py-1 px-1 bg-rose-950/10 rounded-r">
                  <div className="text-rose-400 font-semibold text-[10px] mb-0.5 uppercase tracking-wide">
                    STDERR
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-rose-400 select-text leading-relaxed">
                    {res.stderr}
                  </pre>
                </div>
              )}

              {/* Special message from compiler */}
              {res?.message && (
                <div className="pl-3 border-l-2 border-yellow-500/80 text-yellow-300 text-[11px] py-1 px-1">
                  <pre className="whitespace-pre-wrap font-mono">{res.message}</pre>
                </div>
              )}

              {/* Empty Output Note */}
              {res && !res.stdout && !res.stderr && !res.compile_output && !res.message && (
                <div className="text-[var(--ide-muted)] italic text-[11px] pl-3">
                  (Program finished with no console output)
                </div>
              )}

              {/* Process summary footer */}
              {res && (
                <div className="flex items-center gap-3 text-[10px] text-[var(--ide-muted)] pt-0.5 pl-3 select-none">
                  <div className="flex items-center gap-1">
                    {res.status.id === 3 ? (
                      <span className="text-[var(--ide-success)] flex items-center gap-1 font-semibold">
                        <CheckCircle2 size={11} /> {res.status.description}
                      </span>
                    ) : (
                      <span className="text-rose-400 flex items-center gap-1 font-semibold">
                        <AlertCircle size={11} /> {res.status.description}
                      </span>
                    )}
                  </div>
                  {res.time && (
                    <div className="flex items-center gap-1">
                      <Clock size={10} />
                      <span>{res.time}s</span>
                    </div>
                  )}
                  {res.memory && (
                    <div className="flex items-center gap-1">
                      <Cpu size={10} />
                      <span>{(res.memory / 1024).toFixed(1)} MB</span>
                    </div>
                  )}
                </div>
              )}

              {/* Divider between sessions */}
              {idx < history.length - 1 && (
                <div className="border-b border-[var(--ide-border)] my-2" />
              )}
            </div>
          );
        })}

        {/* Active Running State */}
        {isRunning && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-1.5 text-[var(--ide-text)]">
              <span className="text-[var(--ide-success)] font-semibold">guest@skiffy</span>
              <span className="text-[var(--ide-muted)]">:</span>
              <span className="text-[var(--ide-accent)] font-semibold">~</span>
              <span className="text-[var(--ide-muted)]">$</span>
              <span className="text-[var(--ide-text)] font-medium">{currentRunningCmd}</span>
            </div>
            <div className="flex items-center gap-2 pl-3 text-[var(--ide-success)] text-xs py-1">
              <Loader2 size={13} className="animate-spin" />
              <span className="animate-pulse">Running code…</span>
            </div>
          </div>
        )}

        <div ref={terminalBottomRef} />
      </div>

      {/* ── Status Bar at Terminal Bottom ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--ide-panel)] border-t border-[var(--ide-border)] text-[10px] font-mono text-[var(--ide-muted)] select-none">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isRunning
                  ? 'bg-amber-400 animate-ping'
                  : isAccepted
                  ? 'bg-emerald-400'
                  : 'bg-[var(--ide-panel)]'
              }`}
            />
            <span className="text-[var(--ide-text)]">
              {isRunning
                ? 'RUNNING'
                : lastResult
                ? lastResult.status.description.toUpperCase()
                : 'READY'}
            </span>
          </span>
          {lastResult?.time && (
            <span>• {lastResult.time}s</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span>Ctrl + Enter to Run</span>
          <span className="text-[var(--ide-muted)]">|</span>
          <span className="text-[var(--ide-muted)]">Output</span>
        </div>
      </div>
    </div>
  );
};
