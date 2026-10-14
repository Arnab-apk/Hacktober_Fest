import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../skippy_paradox/frontend/node_modules/typescript/lib/typescript.js';

const source = (await fs.readFile(new URL('../skippy_paradox/frontend/src/services/githubService.ts', import.meta.url), 'utf8')).replace('import.meta.env.VITE_API_URL', "''");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { pushFilesToGitHub } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const options = { owner: 'alice', repo: 'demo', branch: 'feature/test', message: 'Test', token: 'test-token', files: [{ path: 'src/main.py', content: 'print("hello")' }] };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('push preserves the requested branch, creates it if missing, and never force pushes', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/git/ref/heads/feature/test')) return response({ message: 'Not Found' }, 404);
    if (url.endsWith('/repos/alice/demo')) return response({ default_branch: 'main' });
    if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head' } });
    if (url.endsWith('/git/commits/head')) return response({ tree: { sha: 'base' } });
    if (url.endsWith('/git/blobs')) return response({ sha: 'blob' });
    if (url.endsWith('/git/trees')) return response({ sha: 'tree' });
    if (url.endsWith('/git/commits')) return response({ sha: 'commit' });
    if (url.endsWith('/git/refs')) return response({});
    throw new Error('Unexpected request ' + url);
  };
  const result = await pushFilesToGitHub(options);
  assert.equal(result.commitSha, 'commit');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { ref: 'refs/heads/feature/test', sha: 'commit' });
  assert.ok(!calls.some(c => c.init?.method === 'PATCH'));
});
test('authentication errors do not fall back to another branch', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ message: 'Bad credentials' }, 401); };
  await assert.rejects(pushFilesToGitHub(options), /Bad credentials/);
  assert.equal(calls, 1);
});
test('duplicate paths are rejected before sending any data', async () => {
  globalThis.fetch = async () => { throw new Error('Should not fetch'); };
  await assert.rejects(pushFilesToGitHub({ ...options, files: [options.files[0], options.files[0]] }), /Duplicate file path/);
});
test('an empty repository is initialized with actual UTF-8 content', async () => {
  let initialized;
  globalThis.fetch = async (url, init) => {
    if (url.includes('/git/ref/heads/')) return response({ message: 'Git Repository is empty.' }, 409);
    if (url.endsWith('/repos/alice/demo')) return response({ default_branch: 'main' });
    if (url.includes('/branches?')) return response([]);
    if (url.includes('/contents/')) { initialized = JSON.parse(init.body); return response({ commit: { sha: 'initial', html_url: 'https://github.com/alice/demo/commit/initial' } }); }
    throw new Error(url);
  };
  const result = await pushFilesToGitHub(options);
  assert.equal(result.commitSha, 'initial');
  assert.equal(initialized.branch, 'feature/test');
  assert.equal(Buffer.from(initialized.content, 'base64').toString(), options.files[0].content);
});
