import { CollabProvider, buildWsUrl } from './collabService';
export interface Project { id: string; name: string; directory: string; updatedAt: number; activeFileId?: string | null; config: { testCommand: string }; agentBusy: boolean }
export interface DiskFile { id: string; path: string; name: string; content: string; hash: string }
export interface Checkpoint { id: string; label: string; createdAt: number; files: Array<{ path: string; hash: string }> }
export interface ProjectSnapshot { syncError?: string; project: Project; files: DiskFile[]; skipped: string[]; checkpoints: Checkpoint[] }
export interface FileDiff { path: string; status: string; binary: boolean; before: string | null; after: string | null }
export interface TerminalInfo { id: string; owner: string | null; alive: boolean; title: string; agent: boolean; exitCode?: number }
const configured = (import.meta.env.VITE_COLLAB_URL || '').trim().replace(/\/+$/, '').replace(/^ws:/,'http:').replace(/^wss:/,'https:');
export const WORKSPACE_BASE = configured ? configured + '/workspace-api' : '/workspace-api';
export function clientId(): string {
  let id = localStorage.getItem('skippy-workspace-client');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('skippy-workspace-client', id); }
  return id;
}
export function workspaceHeaders(room?: CollabProvider | null): Record<string,string> {
  return { 'Content-Type':'application/json', 'X-Ide-Client':clientId(), Authorization:'Bearer ' + (sessionStorage.getItem('harness-access-token') || ''), ...(room?.status === 'connected' ? {'X-Room-Id':room.roomId,'X-Room-Token':room.workspaceCredentials.roomToken} : {}) };
}
export async function workspaceRequest<T>(route: string, room?: CollabProvider | null, data?: unknown): Promise<T> {
  const response = await fetch(WORKSPACE_BASE + route,{method:data === undefined ? 'GET' : 'POST',headers:workspaceHeaders(room),body:data === undefined ? undefined : JSON.stringify(data)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Workspace service returned ${response.status}. Start the local IDE stack.`);
  return result;
}
export function terminalUrl() { return buildWsUrl('/terminal'); }
