// ─── Language Detection — powered by Google Magika ──────────────────────
// Two-tier detection system:
//   1. Synchronous: Extension lookup (instant, used for immediate UI feedback)
//   2. Async AI:    Google Magika deep-learning model (~99% accuracy)
//
// The synchronous detector is used for immediate UI feedback. The async AI
// detector refines the result once the model loads.

import { Magika } from 'magika';

// ─── Extension Mapping ─────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  py: 'Python', pyw: 'Python', pyi: 'Python',
  cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hxx: 'C++',
  c: 'C', h: 'C',
  java: 'Java',
  go: 'Go',
  rs: 'Rust',
  rb: 'Ruby', erb: 'Ruby',
  php: 'PHP',
  html: 'HTML', htm: 'HTML',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  json: 'JSON', jsonc: 'JSON',
  md: 'Markdown', mdx: 'Markdown',
  yaml: 'YAML', yml: 'YAML',
  xml: 'XML', svg: 'XML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  sql: 'SQL',
  r: 'R',
  swift: 'Swift',
  kt: 'Kotlin', kts: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  scala: 'Scala',
  toml: 'TOML',
  ini: 'INI',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
};

// ─── Magika Label → Display Language Mapping ────────────────────────────
// Magika returns lowercase labels like "javascript", "python", "c", "cpp"
// We map them to our display names used in the UI.

const MAGIKA_LABEL_MAP: Record<string, string> = {
  // Core languages
  javascript: 'JavaScript', jsx: 'JavaScript',
  typescript: 'TypeScript', tsx: 'TypeScript',
  python: 'Python',
  c: 'C', h: 'C',
  cpp: 'C++', hpp: 'C++',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby', erb: 'Ruby',
  php: 'PHP',
  cs: 'C#',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  scala: 'Scala',
  perl: 'Perl',
  r: 'R',
  // Web / markup
  html: 'HTML',
  css: 'CSS', scss: 'SCSS', less: 'Less',
  json: 'JSON', jsonc: 'JSON', jsonl: 'JSON',
  xml: 'XML', svg: 'SVG', xsd: 'XML',
  markdown: 'Markdown', rst: 'reStructuredText',
  yaml: 'YAML',
  // Shell / scripting
  shell: 'Shell', batch: 'Batch', powershell: 'PowerShell',
  awk: 'AWK', tcl: 'Tcl',
  // Systems / low-level
  asm: 'Assembly', verilog: 'Verilog', vhdl: 'VHDL',
  // JVM / .NET
  groovy: 'Groovy', clojure: 'Clojure',
  // Functional
  haskell: 'Haskell', elixir: 'Elixir', erlang: 'Erlang',
  ocaml: 'OCaml', lisp: 'Lisp', scheme: 'Scheme',
  // Modern / niche
  zig: 'Zig', nim: 'Nim', julia: 'Julia', gleam: 'Gleam',
  solidity: 'Solidity', prolog: 'Prolog',
  coffeescript: 'CoffeeScript', vue: 'Vue',
  // Config / data formats
  sql: 'SQL',
  toml: 'TOML', ini: 'INI', csv: 'CSV', tsv: 'TSV',
  dockerfile: 'Dockerfile', makefile: 'Makefile',
  cmake: 'CMake', bazel: 'Bazel', gradle: 'Gradle',
  proto: 'Protobuf', protobuf: 'Protobuf',
  latex: 'LaTeX', diff: 'Diff',
  // Catch-all text types
  txt: 'Text', txtascii: 'Text', txtutf8: 'Text', txtutf16: 'Text',
};

export function inferLanguageFromSnippet(content: string): string {
  if (!content) return '';
  const c = content.trim();
  if (!c) return '';
  if (/\b(def\s+\w+|import\s+\w+|from\s+\w+\s+import|print\s*\(|elif\s+|if\s+__name__\s*==|class\s+\w+:)/.test(c)) return 'Python';
  if (/\b(console\.log|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|function\s*\(|=>)/.test(c)) return 'JavaScript';
  if (/#include\s*<iostream>|std::|cout\s*<</.test(c)) return 'C++';
  if (/#include\s*<stdio\.h>|printf\s*\(/.test(c)) return 'C';
  if (/\b(public\s+class|System\.out\.print|public\s+static\s+void\s+main)/.test(c)) return 'Java';
  if (/\b(package\s+main|func\s+main\(\)|fmt\.Print)/.test(c)) return 'Go';
  if (/\b(fn\s+main\(\)|println!\s*\(|let\s+mut\s+)/.test(c)) return 'Rust';
  if (/\b(using\s+System|Console\.WriteLine)/.test(c)) return 'C#';
  if (/<\?php|\b(\$_POST|\$_GET|\$this->)/.test(c)) return 'PHP';
  if (/\b(puts\s+|def\s+\w+.*end|require\s+['"])/.test(c)) return 'Ruby';
  if (/^#!\/bin\/(bash|sh)|\becho\s+/.test(c)) return 'Shell';
  if (/\b(SELECT\s+.*FROM|INSERT\s+INTO|CREATE\s+TABLE)/i.test(c)) return 'SQL';
  if (/<!DOCTYPE\s+html|<html|<div|<body/i.test(c)) return 'HTML';
  return '';
}

// ─── Synchronous Detection (Extension + Heuristics) ─────────────────────

/**
 * **Synchronous** language detection using file extension and content heuristics.
 * Use this for immediate UI feedback (status bar, language icon, editor syntax)
 * without waiting for the async AI model.
 */
export function detectLanguage(fileName: string, content: string = ''): string {
  if (fileName) {
    // Handle special filenames like "Dockerfile", "Makefile"
    const baseName = fileName.split('/').pop()?.toLowerCase() || '';
    if (baseName === 'dockerfile') return 'Dockerfile';
    if (baseName === 'makefile' || baseName === 'gnumakefile') return 'Makefile';

    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext && ext !== baseName && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
  }

  if (content) {
    const inferred = inferLanguageFromSnippet(content);
    if (inferred) return inferred;
  }

  return '';
}

// ─── Magika Singleton ───────────────────────────────────────────────────
// The model is loaded once and reused for all subsequent detections.

let magikaInstance: Magika | null = null;
let magikaInitPromise: Promise<Magika> | null = null;

async function getMagika(): Promise<Magika> {
  if (magikaInstance) return magikaInstance;
  if (magikaInitPromise) return magikaInitPromise;

  magikaInitPromise = Magika.create().then(instance => {
    magikaInstance = instance;
    console.log('[Magika] AI model loaded successfully');
    return instance;
  });

  return magikaInitPromise;
}

// ─── Async AI Detection ─────────────────────────────────────────────────

/**
 * **Async** language detection powered by Google Magika AI.
 * Uses a ~few MB deep learning model for ~99% accuracy across 200+ content types.
 *
 * Falls back to extension-based detection if the model hasn't loaded yet
 * or if the content is too short for reliable AI detection.
 *
 * @returns The detected language display name (e.g., "JavaScript", "Python")
 */
export async function detectLanguageAI(
  fileName: string,
  content: string
): Promise<string> {
  // 1. Quick extension match — always try this first
  const extResult = detectLanguage(fileName, content);

  // 2. If content is too short, trust the extension
  if (!content || content.trim().length < 20) {
    return extResult || '';
  }

  try {
    const magika = await getMagika();

    // Convert string content to bytes for Magika
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);

    const prediction = await magika.identifyBytes(bytes);

    // Use the `output` label (post-processed by Magika's heuristics)
    const label = prediction?.prediction?.output?.label || '';
    const mappedLanguage = MAGIKA_LABEL_MAP[label] || '';

    // If Magika returned a known code language, use it
    if (mappedLanguage && mappedLanguage !== 'Text') {
      return mappedLanguage;
    }

    // If Magika says "text" or unknown, fall back to extension
    return extResult || mappedLanguage || '';
  } catch (err) {
    console.warn('[Magika] AI detection failed, using extension fallback:', err);
    return extResult || '';
  }
}

// ─── Preload Model ──────────────────────────────────────────────────────
// Start loading the model in the background as soon as this module is imported.
// This ensures the model is ready by the time the user actually needs it.

getMagika().catch(err => {
  console.warn('[Magika] Background model preload failed:', err);
});
