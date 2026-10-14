import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const python = process.env.SKIPPY_PYTHON || path.join(root, '.venv310', windows ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('Python runtime missing. Run ./setup.ps1 (Windows), or follow README.md.');
  process.exit(1);
}
const env = { ...process.env, PYTHONPATH: path.join(root, 'Skippy_harness'), PYTHONIOENCODING: 'utf-8' };
env.PORT = '4100';
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const services = [
  ['API', python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8100'], 'skippy_paradox/backend'],
  ['Collaboration', process.execPath, ['server.js'], 'skippy_paradox/backend-socket'],
  ['IDE', process.execPath, ['node_modules/vite/bin/vite.js', '--configLoader', 'runner', '--host', '0.0.0.0', '--port', '3100', '--strictPort'], 'skippy_paradox/frontend'],
];
if (process.argv.includes('--preview')) services[2] = ['IDE', process.execPath, ['scripts/serve.mjs'], '.'];
const children = [];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (windows) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
for (const [name, command, args, cwd] of services) {
  const child = spawn(command, args, { cwd: path.join(root, cwd), env, windowsHide: true, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(`${name}: ${error.message}`); close(); process.exitCode = 1; });
  child.on('exit', code => { if (!closing) { console.error(`${name} exited (${code}). Stopping services.`); close(); process.exitCode = code || 1; } });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
console.log('\nSkippy IDE: http://localhost:3100\nBoth collaborators must open the same IDE server. Ctrl+C stops all services.\n');
