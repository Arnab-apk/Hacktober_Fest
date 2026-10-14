import { StoredFile } from './storageService';
import { fetchRawContent, getStoredToken } from './githubService';

const configured = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const API_BASE = configured ? (configured.endsWith('/api') ? configured : configured + '/api') : '/api';

export interface HarnessEvent {
  type: string;
  content?: string;
  message?: string;
  path?: string;
  previous?: string | null;
  name?: string;
  arguments?: string;
  result?: string;
  status?: string;
  id?: string;
  reason?: string;
  runId?: string;
  token?: string;
  author?: string;
}

export interface RunRequestBody {
  provider: 'ollama' | 'openrouter' | 'gemini';
  model: string;
  apiKey?: string;
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  files: Array<{ path: string; content: string }>;
}

async function checked(response: Response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `Server error ${response.status}. Check your configuration.`);
  }
  return response;
}

export const POPULAR_OPENROUTER_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-lightning',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'google/gemini-2.0-flash-exp:free',
];

export async function loadModels(provider: string, apiKey: string, accessToken: string, signal?: AbortSignal) {
  return (await checked(await fetch(`${API_BASE}/harness/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ provider, apiKey }),
    signal,
  }))).json();
}

export async function hydrateFiles(files: StoredFile[]): Promise<StoredFile[]> {
  // Fetch lazy repository content before giving it to the agent or GitHub push.
  const result: StoredFile[] = [];
  for (const file of files) {
    if (file.contentLoaded === false) {
      if (!file.repoOrigin) throw new Error(`Load ${file.path || file.name} before continuing.`);
      const origin = file.repoOrigin;
      const content = await fetchRawContent(origin.owner, origin.repo, origin.branch, file.path || file.name, getStoredToken() || undefined);
      result.push({ ...file, content, contentLoaded: true });
    } else result.push({ ...file });
  }
  return result;
}

export async function streamHarness(
  body: unknown,
  accessToken: string,
  signal: AbortSignal,
  onEvent: (event: HarnessEvent) => Promise<void>
) {
  const response = await checked(await fetch(`${API_BASE}/harness/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    signal,
  }));
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'done' || event.type === 'error') finished = true;
        if (event.type !== 'heartbeat') await onEvent(event);
      }
      if (done) break;
    }
    if (!finished) throw new Error('Connection ended before the harness finished. Applied edits are saved.');
  } finally {
    reader.releaseLock();
  }
}

export async function approveCommand(runId: string, token: string, approved: boolean) {
  await checked(await fetch(`${API_BASE}/harness/runs/${runId}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Run-Token': token },
    body: JSON.stringify({ approved }),
  }));
}

export async function cancelRun(runId: string, token: string) {
  await fetch(`${API_BASE}/harness/runs/${runId}`, { method: 'DELETE', headers: { 'X-Run-Token': token } });
}
