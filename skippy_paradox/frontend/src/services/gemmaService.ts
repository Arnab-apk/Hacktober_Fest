import { API_BASE } from './harnessService';

export type MentorMode = 'explain' | 'review' | 'debug' | 'plan';
export type GemmaProvider = 'gemini' | 'ollama' | 'openrouter';
export interface GemmaStatus { configured: boolean; model: string; models?: string[]; provider?: GemmaProvider }
export interface MentorMessage { role: 'user' | 'assistant'; content: string }
export interface MentorImage { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }
export interface MentorRequest {
  provider?: GemmaProvider;
  model?: string;
  prompt: string;
  mode: MentorMode;
  history: MentorMessage[];
  code?: { path: string; language: string; content: string; truncated: boolean };
  image?: MentorImage;
}

async function request<T>(path: string, token: string, signal: AbortSignal, body?: MentorRequest): Promise<T> {
  const response = await fetch(`${API_BASE}/gemma/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `Gemma request failed (${response.status}).`);
  return result;
}

export const gemmaStatus = (token: string, signal: AbortSignal, provider: GemmaProvider = 'gemini') => request<GemmaStatus>(`status?provider=${provider}`, token, signal);
export const askGemma = (body: MentorRequest, token: string, signal: AbortSignal) => request<{ text: string; model: string; finishReason: string }>('mentor', token, signal, body);

export async function readMentorImage(file: File): Promise<MentorImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 4 * 1024 * 1024) throw new Error('Use an image smaller than 4 MB.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
  return { mimeType: file.type as MentorImage['mimeType'], data };
}
