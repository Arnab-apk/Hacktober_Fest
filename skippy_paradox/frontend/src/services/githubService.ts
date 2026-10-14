// ─── GitHub Service ─────────────────────────────────────────────────────
// Handles GitHub OAuth popup flow + proxied API calls via backend.

const GH_TOKEN_KEY = 'codecollab-github-token';
const GH_USER_KEY = 'codecollab-github-user';
const OAUTH_RESULT_KEY = 'codecollab-github-oauth-result';
const RAW_API_URL = (import.meta.env.VITE_API_URL || '').trim();
const NORMALIZED_API_URL = RAW_API_URL.replace(/\/+$/, '');
const API_BASE = NORMALIZED_API_URL
  ? (NORMALIZED_API_URL.endsWith('/api') ? NORMALIZED_API_URL : `${NORMALIZED_API_URL}/api`)
  : '/api';

function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getExpectedPopupOrigin(): string {
  if (isAbsoluteHttpUrl(API_BASE)) {
    return new URL(API_BASE).origin;
  }
  return window.location.origin;
}

interface OAuthPopupResult {
  type: 'github-oauth';
  token?: string;
  error?: string;
}

function isOAuthPopupResult(value: unknown): value is OAuthPopupResult {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.type === 'github-oauth';
}

// ─── Token Management ──────────────────────────────────────────────────

export function getStoredToken(): string | null {
  return localStorage.getItem(GH_TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(GH_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(GH_TOKEN_KEY);
  localStorage.removeItem(GH_USER_KEY);
  localStorage.removeItem(OAUTH_RESULT_KEY);
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export function getStoredUser(): GitHubUser | null {
  try {
    const raw = localStorage.getItem(GH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: GitHubUser): void {
  localStorage.setItem(GH_USER_KEY, JSON.stringify(user));
}

// ─── Auth Headers ──────────────────────────────────────────────────────

function authHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ─── OAuth Popup Flow ──────────────────────────────────────────────────

/**
 * Opens a popup to the backend OAuth endpoint.
 * Returns a Promise that resolves with the access token
 * when the popup sends it back via postMessage.
 */
export function startOAuthPopup(): Promise<string> {
  return new Promise((resolve, reject) => {
    const expectedPopupOrigin = getExpectedPopupOrigin();
    const allowStorageFallback = expectedPopupOrigin === window.location.origin;
    const popupCloseGraceMs = 1500;

    if (allowStorageFallback) {
      localStorage.removeItem(OAUTH_RESULT_KEY);
    }

    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      apiUrl('/auth/github'),
      'github-oauth',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    );

    if (!popup) {
      reject(new Error('Popup was blocked. Please allow popups for this site.'));
      return;
    }

    let completed = false;
    let pollTimer: number | undefined;
  let popupClosedAt: number | null = null;

    const complete = (payload: OAuthPopupResult) => {
      if (completed) return;
      completed = true;
      cleanup();

      if (payload.error) {
        reject(new Error(payload.error));
      } else if (payload.token) {
        resolve(payload.token);
      } else {
        reject(new Error('No token received from GitHub.'));
      }
    };

    const completeFromStorage = () => {
      if (!allowStorageFallback) return false;
      const raw = localStorage.getItem(OAUTH_RESULT_KEY);
      if (!raw) return false;
      try {
        const payload = JSON.parse(raw);
        localStorage.removeItem(OAUTH_RESULT_KEY);
        if (!isOAuthPopupResult(payload)) return false;
        complete(payload);
        return true;
      } catch {
        localStorage.removeItem(OAUTH_RESULT_KEY);
        return false;
      }
    };

    const cleanup = () => {
      window.removeEventListener('message', handler);
      window.removeEventListener('storage', storageHandler);
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
      }
    };

    const handler = (event: MessageEvent) => {
      // Accept only messages from the popup we opened.
      if (event.source !== popup && event.source !== null) return;
      if (event.origin !== expectedPopupOrigin) return;
      if (!isOAuthPopupResult(event.data)) return;
      complete(event.data);
    };

    const storageHandler = (event: StorageEvent) => {
      if (event.key !== OAUTH_RESULT_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        localStorage.removeItem(OAUTH_RESULT_KEY);
        if (!isOAuthPopupResult(payload)) return;
        complete(payload);
      } catch {
        localStorage.removeItem(OAUTH_RESULT_KEY);
      }
    };

    // Poll for popup closed without completing auth
    pollTimer = window.setInterval(() => {
      if (popup.closed) {
        if (popupClosedAt === null) {
          popupClosedAt = Date.now();
          return;
        }

        if (allowStorageFallback && completeFromStorage()) return;
        if (Date.now() - popupClosedAt < popupCloseGraceMs) return;
        if (completed) return;
        completed = true;
        cleanup();
        reject(new Error('Authentication cancelled.'));
      }
    }, 500);

    window.addEventListener('message', handler);
    if (allowStorageFallback) {
      window.addEventListener('storage', storageHandler);
    }
  });
}

// ─── Validate Token / Get User ─────────────────────────────────────────

export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(apiUrl('/github/user'), {
      headers: authHeaders(token),
    });

    if (res.ok) {
      return res.json();
    }

    const retriable = res.status === 401 || res.status === 403 || res.status >= 500;
    if (retriable && attempt < maxAttempts) {
      await delay(300);
      continue;
    }

    throw new Error('Failed to fetch GitHub user. Token may be invalid.');
  }

  throw new Error('Failed to fetch GitHub user. Token may be invalid.');
}

// ─── Repos ─────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
  default_branch: string;
  owner: { login: string; avatar_url: string };
}

export async function listRepos(
  token: string,
  page = 1,
  perPage = 100,
  sort: 'updated' | 'pushed' | 'full_name' = 'updated'
): Promise<GitHubRepo[]> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    sort,
  });
  const res = await fetch(`${apiUrl('/github/repos')}?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch repositories.');
  return res.json();
}

// ─── Repo Contents (Tree) ──────────────────────────────────────────────

export interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
  download_url: string | null;
}

export async function getRepoContents(
  token: string,
  owner: string,
  repo: string,
  path = ''
): Promise<GitHubContent[]> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const res = await fetch(
    `${apiUrl(`/github/repos/${owner}/${repo}/contents`)}?${params}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`Failed to fetch contents for ${owner}/${repo}/${path}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [data];
  return data;
}

// ─── Fetch File Content ────────────────────────────────────────────────

export async function fetchFileContent(
  downloadUrl: string,
  token?: string | null
): Promise<string> {
  const params = new URLSearchParams({ url: downloadUrl });
  const res = await fetch(`${apiUrl('/github/file')}?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch file content.');
  return res.text();
}

// ─── Repo Tree (Full Import) ───────────────────────────────────────────

export interface RepoTreeItem {
  path: string;
  type: 'blob' | 'tree';  // blob = file, tree = dir
  size: number;
  sha: string;
}

export interface RepoTree {
  tree: RepoTreeItem[];
  sha: string;
  truncated: boolean;
}

export async function fetchRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoTree> {
  const res = await fetch(
    apiUrl(`/github/repos/${owner}/${repo}/tree/${branch}`),
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`Failed to fetch repo tree for ${owner}/${repo}`);
  return res.json();
}

/**
 * Fetch raw file content by constructing the raw URL.
 * Works for both public and private repos when token is provided.
 */
export async function fetchRawContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token?: string | null
): Promise<string> {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const params = new URLSearchParams({ url: rawUrl });
  const res = await fetch(`${apiUrl('/github/file')}?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch file content.');
  return res.text();
}

// ─── Public URL Parsing ────────────────────────────────────────────────

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  fileName: string;
}

/**
 * Parses GitHub URLs in these formats:
 * - https://github.com/owner/repo/blob/branch/path/to/file.ext
 * - https://raw.githubusercontent.com/owner/repo/branch/path/to/file.ext
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const blobRegex = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
  const blobMatch = url.match(blobRegex);
  if (blobMatch) {
    const filePath = blobMatch[4];
    return { owner: blobMatch[1], repo: blobMatch[2], branch: blobMatch[3], path: filePath, fileName: filePath.split('/').pop() || filePath };
  }

  const rawRegex = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;
  const rawMatch = url.match(rawRegex);
  if (rawMatch) {
    const filePath = rawMatch[4];
    return { owner: rawMatch[1], repo: rawMatch[2], branch: rawMatch[3], path: filePath, fileName: filePath.split('/').pop() || filePath };
  }

  return null;
}

/**
 * Fetches file content from a public GitHub URL (no auth needed for public repos).
 */
export async function fetchFromPublicUrl(url: string): Promise<{ fileName: string; content: string }> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new Error('Invalid GitHub URL. Supported formats:\n• https://github.com/owner/repo/blob/branch/file\n• https://raw.githubusercontent.com/owner/repo/branch/file');
  }

  const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.branch}/${parsed.path}`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    if (res.status === 404) throw new Error('File not found. Make sure the repository and file are public.');
    throw new Error(`Failed to fetch file (${res.status}).`);
  }

  return { fileName: parsed.fileName, content: await res.text() };
}

// ─── Push to GitHub (Git Data API) ─────────────────────────────────────

export interface PushOptions {
  owner: string;
  repo: string;
  branch?: string;
  message: string;
  files: Array<{ path: string; content: string }>;
  token: string;
}

export interface PushResult {
  success: boolean;
  commitSha: string;
  commitUrl: string;
  filesPushed: number;
}

export async function pushFilesToGitHub(options: PushOptions): Promise<PushResult> {
  const { owner, repo, branch = 'main', message, files, token } = options;
  if (!token) throw new Error('GitHub token is required to push changes.');
  if (files.length === 0) throw new Error('No files selected to push.');
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('Invalid repository owner or name.');
  if (!branch || /[\s~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.startsWith('/')) throw new Error('Invalid branch name.');
  const paths = new Set<string>();
  for (const file of files) {
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some(p => !p || p === '..' || p === '.')) throw new Error(`Invalid file path: ${file.path}`);
    if (paths.has(file.path)) throw new Error(`Duplicate file path: ${file.path}. Choose a narrower push scope.`);
    paths.add(file.path);
  }

  const authHeader = token.startsWith('Bearer ') || token.startsWith('token ') ? token : `token ${token}`;
  const ghHeaders: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': authHeader,
    'Content-Type': 'application/json',
  };

  const ghFetch = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers: { ...ghHeaders, ...(init?.headers as Record<string, string> || {}) } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const failure = new Error((err as any).message || `GitHub API error ${res.status}: ${url}`) as Error & { status: number };
      failure.status = res.status;
      throw failure;
    }
    return res.json();
  };

  // ── 1. Resolve branch ref ──────────────────────────────────────────────
  const targetBranch = branch;
  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
  let createBranch = false;
  let branchData: any;
  try {
    branchData = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodedBranch}`);
  } catch (e: any) {
    if (e.status !== 404 && e.status !== 409) throw e;
    const repoInfo = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
    try {
      branchData = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(repoInfo.default_branch)}`);
      createBranch = true;
    } catch (baseError: any) {
      if (baseError.status !== 409 && baseError.status !== 404) throw baseError;
      const branches = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=1`);
      if (branches.length) throw new Error('Could not resolve the base branch. Choose an existing branch.');
      // GitHub requires a Contents API write to initialize an empty repository.
      const first = files[0];
      const initial = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${first.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT', body: JSON.stringify({ message, branch, content: btoa(unescape(encodeURIComponent(first.content))) }),
      });
      if (files.length === 1) return { success: true, commitSha: initial.commit.sha, commitUrl: initial.commit.html_url, filesPushed: 1 };
      branchData = { object: { sha: initial.commit.sha } };
    }
  }
  const latestCommitSha: string = branchData.object.sha;

  // ── 2. Get base tree SHA from HEAD commit ──────────────────────────────
  const commitData = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  const baseTreeSha: string = commitData.tree.sha;

  // ── 3. Create blobs individually (base64 encoded) ─────────────────────
  //    Using blobs API avoids GitRPC::BadObjectState that occurs when
  //    embedding raw content strings directly in the tree payload.
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];

  for (const file of files) {
    const cleanPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;

    // Encode content to base64 (works for any UTF-8 text)
    const encoded = btoa(unescape(encodeURIComponent(file.content)));

    const blobData = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: encoded, encoding: 'base64' }),
    });

    treeEntries.push({
      path: cleanPath,
      mode: '100644',
      type: 'blob',
      sha: blobData.sha,
    });
  }

  // ── 4. Create tree referencing blob SHAs ──────────────────────────────
  const newTreeData = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  const newTreeSha: string = newTreeData.sha;

  // ── 5. Create commit ──────────────────────────────────────────────────
  const newCommitData = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTreeSha, parents: [latestCommitSha] }),
  });
  const newCommitSha: string = newCommitData.sha;

  // ── 6. Update branch ref ──────────────────────────────────────────────
  await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs${createBranch ? '' : `/heads/${encodedBranch}`}`, {
    method: createBranch ? 'POST' : 'PATCH',
    body: JSON.stringify(createBranch ? { ref: `refs/heads/${targetBranch}`, sha: newCommitSha } : { sha: newCommitSha, force: false }),
  });

  return {
    success: true,
    commitSha: newCommitSha,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
    filesPushed: files.length,
  };
}

