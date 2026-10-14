import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const IDE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.skippy', '.skippy-ide', 'dist', 'build', '.next']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\x00-\x1f:]/.test(value)) fail('Invalid file path.');
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || ignored.has(p.toLowerCase()) || /[<>"|?*]/.test(p) || /[ .]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) fail('Unsafe or reserved file path: ' + value);
  return normalized;
}
function writeJSON(filename, value) {
  const temporary = filename + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, filename);
}

export class WorkspaceStore {
  constructor(root = process.env.SKIPPY_WORKSPACE_ROOT || path.join(IDE_ROOT, '.skippy-ide')) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.projects = new Map();
    for (const id of fs.readdirSync(this.root)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.root, id, 'project.json'), 'utf8'));
        if (meta.id === id) this.projects.set(id, { ...meta, agent: null, roomId: null });
      } catch { /* A partial create never becomes a usable project. */ }
    }
  }
  directory(project) { return path.join(this.root, project.id, 'files'); }
  metadata(project) { return path.join(this.root, project.id); }
  get(id) { const project = this.projects.get(id); if (!project) fail('Project not found.', 404); return project; }
  public(project) { return { id: project.id, name: project.name, updatedAt: project.updatedAt, config: project.config, activeFileId: project.activeFileId || null, directory: this.directory(project), agentBusy: !!project.agent }; }
  list() { return [...this.projects.values()].map(p => this.public(p)).sort((a,b) => b.updatedAt - a.updatedAt); }
  persist(project) {
    const { agent, roomId, ...meta } = project;
    writeJSON(path.join(this.metadata(project), 'project.json'), meta);
  }
  create(name, files = []) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) fail('Enter a project name (up to 100 characters).');
    if (this.projects.size >= 100) fail('Project limit reached.', 413);
    this.validateChanges(files.map(f => ({ ...f, previous: null })));
    const project = { id: randomUUID(), name: name.trim(), updatedAt: Date.now(), config: { testCommand: '' }, fileIds: {}, agent: null, roomId: null };
    fs.mkdirSync(this.directory(project), { recursive: true });
    this.projects.set(project.id, project);
    this.sync(project, files.map(f => ({ ...f, previous: null })));
    this.persist(project);
    return this.snapshot(project);
  }
  resolve(project, filename) {
    const relative = relativePath(filename);
    const base = this.directory(project);
    const absolute = path.resolve(base, relative);
    if (!absolute.startsWith(base + path.sep)) fail('File is outside the project.');
    let current = base;
    for (const component of relative.split('/')) {
      current = path.join(current, component);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('Symbolic links are excluded from workspace writes.');
    }
    return absolute;
  }
  walk(project, binary = false) {
    const files = [];
    const skipped = [];
    let total = 0;
    const visit = (directory, prefix = '') => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name.toLowerCase())) continue;
        const filename = prefix + entry.name;
        if (entry.isSymbolicLink()) { skipped.push(filename); continue; }
        if (entry.isDirectory()) { visit(path.join(directory, entry.name), filename + '/'); continue; }
        if (!entry.isFile()) continue;
        try { relativePath(filename); } catch { skipped.push(filename); continue; }
        const full = path.join(directory, entry.name);
        const size = fs.statSync(full).size;
        if (files.length >= 2000 || total + size > 50_000_000) fail('Project exceeds the 2,000 file / 50 MB workspace limit.', 413);
        if (!binary && size > 1_000_000) { skipped.push(filename); continue; }
        const bytes = fs.readFileSync(full);
        total += bytes.length;
        if (binary) files.push({ path: filename, bytes });
        else {
          try {
            if (bytes.includes(0)) throw new Error('Binary');
            const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            const id = project.fileIds[filename] ||= randomUUID();
            files.push({ id, path: filename, name: filename.split('/').pop(), content, hash: hash(bytes) });
          } catch { skipped.push(filename); }
        }
      }
    };
    visit(this.directory(project));
    return { files, skipped };
  }
  snapshot(project) {
    const snapshot = this.walk(project);
    this.persist(project);
    return { project: this.public(project), ...snapshot, checkpoints: this.checkpoints(project) };
  }
  validateChanges(changes) {
    if (!Array.isArray(changes) || changes.length > 2000) fail('Invalid file changes.');
    const paths = new Set();
    let size = 0;
    for (const change of changes) {
      const relative = relativePath(change.path);
      const key = relative.toLowerCase();
      if (paths.has(key)) fail('Duplicate file path: ' + relative);
      paths.add(key);
      if (change.content !== null && typeof change.content !== 'string') fail('Invalid content for ' + relative);
      if (change.previous !== null && typeof change.previous !== 'string') fail('Missing file baseline for ' + relative);
      if ((change.content?.length || 0) > 1_000_000) fail('File is too large: ' + relative, 413);
      size += change.content?.length || 0;
    }
    if (size > 10_000_000) fail('Save exceeds 10 MB.', 413);
  }
  sync(project, changes) {
    this.validateChanges(changes);
    const pending = [];
    const conflicts = [];
    for (const change of changes) {
      const filename = this.resolve(project, change.path);
      const current = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
      if (current === change.content) continue;
      if (current !== change.previous) { conflicts.push(change.path); continue; }
      pending.push({ ...change, filename });
    }
    if (conflicts.length) fail('Files changed on disk: ' + conflicts.join(', ') + '. Review the conflict before saving.', 409);
    // Validate the whole batch before the first write; never partially apply a stale editor save.
    for (const change of pending) {
      if (change.content === null) fs.unlinkSync(change.filename);
      else {
        fs.mkdirSync(path.dirname(change.filename), { recursive: true });
        const temp = change.filename + '.skippy-save-' + randomUUID();
        try { fs.writeFileSync(temp, change.content); fs.renameSync(temp, change.filename); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        project.fileIds[change.path] ||= randomUUID();
      }
    }
    project.updatedAt = Date.now();
    this.persist(project);
  }
  checkpoints(project) {
    const directory = path.join(this.metadata(project), 'checkpoints');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))).sort((a,b) => b.createdAt - a.createdAt);
  }
  checkpoint(project, label = 'Checkpoint') {
    const { files } = this.walk(project, true);
    const id = randomUUID();
    const base = path.join(this.metadata(project), 'checkpoints');
    const contents = path.join(base, id);
    fs.mkdirSync(contents, { recursive: true });
    for (const file of files) {
      const filename = path.join(contents, file.path);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, file.bytes);
    }
    const checkpoint = { id, label: String(label).slice(0,120), createdAt: Date.now(), files: files.map(f => ({ path: f.path, hash: hash(f.bytes) })), config: project.config, activeFileId: project.activeFileId || null };
    writeJSON(path.join(base, id + '.json'), checkpoint);
    return checkpoint;
  }
  diff(project, id) {
    const checkpoint = this.checkpoints(project).find(c => c.id === id);
    if (!checkpoint) fail('Checkpoint not found.', 404);
    const before = new Map(checkpoint.files.map(f => [f.path, f]));
    const after = new Map(this.walk(project, true).files.map(f => [f.path, { hash: hash(f.bytes), bytes: f.bytes }]));
    return [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p)?.hash !== after.get(p)?.hash).map(p => {
      const oldBytes = before.has(p) ? fs.readFileSync(path.join(this.metadata(project),'checkpoints',id,p)) : Buffer.alloc(0);
      const newBytes = after.get(p)?.bytes || Buffer.alloc(0);
      const binary = oldBytes.includes(0) || newBytes.includes(0) || oldBytes.length > 1_000_000 || newBytes.length > 1_000_000;
      return { path: p, status: !before.has(p) ? 'added' : !after.has(p) ? 'deleted' : 'modified', binary, before: binary ? null : oldBytes.toString('utf8'), after: binary ? null : newBytes.toString('utf8') };
    });
  }
  restore(project, id) {
    if (project.agent) fail('Stop the active Skippy run before restoring.', 409);
    const checkpoint = this.checkpoints(project).find(c => c.id === id);
    if (!checkpoint) fail('Checkpoint not found.', 404);
    // A restore itself is recoverable, including terminal-created binary files.
    const recovery = this.checkpoint(project, 'Before restoring ' + checkpoint.label);
    const restored = new Set(checkpoint.files.map(f => f.path));
    for (const file of this.walk(project, true).files) if (!restored.has(file.path)) fs.unlinkSync(this.resolve(project,file.path));
    for (const file of checkpoint.files) {
      const filename = this.resolve(project,file.path);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.copyFileSync(path.join(this.metadata(project),'checkpoints',id,file.path),filename);
    }
    project.config = checkpoint.config || { testCommand: '' };
    project.activeFileId = checkpoint.activeFileId;
    project.updatedAt = Date.now();
    this.persist(project);
    return { ...this.snapshot(project), recoveryCheckpoint: recovery.id };
  }
}
