import path from 'node:path';
import fs from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as pty from 'node-pty';
import { WorkspaceStore, IDE_ROOT, fail } from './workspaces.js';

const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const send = (ws, payload) => { if (ws.readyState === 1) { if (ws.bufferedAmount > 2_000_000) ws.close(1013,'Terminal viewer is too slow'); else ws.send(JSON.stringify(payload)); } };
const local = new Set(['localhost','127.0.0.1','[::1]']);
function checkAccess(req, token = '') {
  const configured = process.env.SKIPPY_ACCESS_TOKEN;
  if (configured) { if (!equal(token,configured)) fail('Enter the server access token in Harness settings.',401); return; }
  const host = new URL('http://' + (req.headers.host || '')).hostname;
  const forwarded = req.headers['x-forwarded-host'];
  let origin = null;
  try { origin = req.headers.origin ? new URL(req.headers.origin).hostname : null; } catch { fail('Invalid origin.',403); }
  if (!local.has(host) || (origin && !local.has(origin)) || (forwarded && !local.has(new URL('http://' + forwarded).hostname))) fail('Set SKIPPY_ACCESS_TOKEN on the server for remote workspace access.',403);
}
function body(req) {
  return new Promise((resolve,reject) => {
    let text = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 12_000_000) { reject(Object.assign(new Error('Request is too large.'),{status:413})); req.destroy(); } else text += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(text || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON.'),{status:400})); } });
    req.on('error',reject);
  });
}

export class IdeService {
  constructor(rooms, docs, getOrCreateDoc) {
    this.rooms = rooms; this.docs = docs; this.getOrCreateDoc = getOrCreateDoc;
    this.store = new WorkspaceStore();
    this.terminals = new Map();
    this.timer = setInterval(() => {
      for (const project of this.store.projects.values()) if (project.agent?.kind === 'panel' && project.agent.token && Date.now() - project.agent.heartbeat > 45000) project.agent = null;
      for (const terminal of this.terminals.values()) {
        if (terminal.agent && Date.now() - terminal.agentHeartbeat > 45000) this.releaseTerminalAgent(terminal);
        if (!terminal.viewers.size && !terminal.agent && Date.now() - terminal.lastSeen > 15 * 60_000) this.kill(terminal);
      }
      for (const room of this.rooms.values()) if (room.workspaceId) {
        try { this.refreshRoom(room); this.syncRoom(room); } catch (error) { if (room.diskError !== error.message) { room.diskError = error.message; room.broadcastJson({type:'workspace-error', message:error.message}); } }
      }
    },1000);
    this.timer.unref();
  }
  member(roomId, token) {
    const room = this.rooms.get(roomId);
    const entry = room && [...room.members].find(([,m]) => equal(m.ws.sessionToken,token));
    if (!entry) fail('Reconnect to the collaboration room.',403);
    return { room, peerId: entry[0] };
  }
  context(req, project, credentials = null) {
    const roomId = credentials?.roomId || req.headers['x-room-id'];
    const token = credentials?.roomToken || req.headers['x-room-token'];
    if (project.roomId && this.rooms.has(project.roomId)) {
      const context = this.member(roomId,token);
      if (context.room.roomId !== project.roomId) fail('Project is in another collaboration room.',409);
      return { ...context, owner: context.peerId };
    }
    const clientId = credentials?.clientId || req.headers['x-ide-client'];
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9-]{10,100}$/.test(clientId)) fail('Missing workspace client identity.',401);
    return { room:null, peerId:null, owner:clientId };
  }
  bind(project, room, peerId) {
    if (room.hostId !== peerId) fail('Only the room host can open a shared project.',403);
    if (room.agentOwner || project.agent || [...this.terminals.values()].some(t => t.roomId === room.roomId && t.alive)) fail('Close room terminals and stop Skippy before switching projects.',409);
    if (project.roomId && project.roomId !== room.roomId && this.rooms.has(project.roomId)) fail('Project is already in another room.',409);
    if (room.workspaceId && room.workspaceId !== project.id) this.store.get(room.workspaceId).roomId = null;
    project.roomId = room.roomId; room.workspaceId = project.id;
    for (const terminal of this.terminals.values()) if (terminal.project.id === project.id) terminal.roomId = room.roomId;
    room.diskBaseline = new Map();
    for (const shared of room.sharedFiles.values()) {
      const entry = this.docs.get(`${room.roomId}/${shared.id}`);
      if (entry) { for (const conn of entry.conns.keys()) conn.close(); entry.awareness.destroy(); entry.doc.destroy(); this.docs.delete(`${room.roomId}/${shared.id}`); }
    }
    room.sharedFiles.clear();
    this.refreshRoom(room);
    room.broadcastJson({type:'room-project', workspaceId:project.id});
    room.broadcastJson({type:'files-reordered', sharedFiles:room.getSharedFilesList()});
  }
  refreshRoom(room, force = false) {
    const project = this.store.get(room.workspaceId);
    const disk = this.store.walk(project).files;
    const paths = new Set(disk.map(f => f.path));
    for (const file of disk) {
      const shared = [...room.sharedFiles.values()].find(f => f.name === file.path);
      const entry = this.getOrCreateDoc(`${room.roomId}/${shared?.id || file.id}`);
      const text = entry.doc.getText('monaco');
      const previous = room.diskBaseline.get(file.path);
      const current = text.toString();
      if (previous !== undefined && current !== previous && file.content !== previous && file.content !== current && !force) fail('Concurrent disk and editor changes in ' + file.path + '. Save a copy of your editor text, then reopen the project.',409);
      if (!shared || force || current === previous) {
        if (current !== file.content) entry.doc.transact(() => { text.delete(0,text.length); text.insert(0,file.content); });
      }
      if (!shared) {
        const metadata = { id:file.id, name:file.path, language:'', content:file.content };
        room.sharedFiles.set(file.id,metadata);
        room.broadcastJson({type:'file-shared',file:{id:file.id,name:file.path,language:''}});
      }
      room.diskBaseline.set(file.path,file.content);
    }
    for (const [id,file] of room.sharedFiles) if (room.diskBaseline.has(file.name) && !paths.has(file.name)) {
      const entry = this.docs.get(`${room.roomId}/${id}`);
      if (!force && entry?.doc.getText('monaco').toString() !== room.diskBaseline.get(file.name)) fail('Deleted file has unsaved editor changes: '+file.name,409);
      room.sharedFiles.delete(id); room.diskBaseline.delete(file.name);
      room.broadcastJson({type:'file-unshared',fileId:id});
      if (entry) { for (const conn of entry.conns.keys()) conn.close(); entry.awareness.destroy(); entry.doc.destroy(); this.docs.delete(`${room.roomId}/${id}`); }
    }
    room.diskError = '';
  }
  removeShared(room,file) {
    room.sharedFiles.delete(file.id); room.diskBaseline.delete(file.name);
    room.broadcastJson({type:'file-unshared',fileId:file.id});
    const key = `${room.roomId}/${file.id}`, entry = this.docs.get(key);
    if (entry) { for (const conn of entry.conns.keys()) conn.close(); entry.awareness.destroy(); entry.doc.destroy(); this.docs.delete(key); }
  }
  syncRoom(room) {
    const project = this.store.get(room.workspaceId);
    const changes = [];
    for (const file of room.sharedFiles.values()) {
      project.fileIds[file.name] ||= file.id;
      const content = this.docs.get(`${room.roomId}/${file.id}`)?.doc.getText('monaco').toString() ?? file.content;
      const previous = room.diskBaseline.get(file.name) ?? null;
      if (content !== previous) changes.push({path:file.name,content,previous});
    }
    if (changes.length) { this.store.sync(project,changes); for (const f of changes) room.diskBaseline.set(f.path,f.content); }
  }
  beforeAction(project, context) {
    if (context.room) { this.refreshRoom(context.room); this.syncRoom(context.room); }
  }
  roomClaim(room, peerId) {
    if (!room.workspaceId) return;
    const project = this.store.get(room.workspaceId);
    if (project.agent) fail('Skippy is already running in this project.',409);
    this.beforeAction(project,{room});
    this.store.checkpoint(project,'Before AI panel run');
    project.agent = { owner:peerId, kind:'panel' };
  }
  roomRelease(room, peerId) {
    if (!room.workspaceId) return;
    const project = this.store.get(room.workspaceId);
    if (project.agent?.owner === peerId) project.agent = null;
  }
  async handleHttp(req,res) {
    if (!req.url.startsWith('/workspace-api/') && !req.url.startsWith('/internal/terminal-agent/')) return false;
    const reply = (data,status=200) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url,'http://localhost');
      if (url.pathname.startsWith('/internal/terminal-agent/')) {
        if (req.method !== 'POST' || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail('Local launcher only.',403);
        const request = await body(req);
        const terminal = [...this.terminals.values()].find(t => equal(t.launcherToken,request.token));
        if (!terminal || !terminal.alive) fail('Terminal expired.',404);
        const action = url.pathname.split('/').pop();
        if (action === 'claim') {
          if (terminal.project.agent) fail('Another Skippy run is active. Wait for it to finish.',409);
          const room = this.rooms.get(terminal.roomId);
          if (room?.agentOwner) fail('Another collaborator is using Skippy.',409);
          if (room) this.beforeAction(terminal.project,{room});
          this.store.checkpoint(terminal.project,'Before terminal Skippy run');
          terminal.agent = true; terminal.agentHeartbeat = Date.now();
          terminal.project.agent = {owner:terminal.id,kind:'terminal'};
          if (room) { room.agentOwner = 'terminal:'+terminal.id; room.broadcastJson({type:'agent-owner',peerId:room.agentOwner,displayName:'Terminal Skippy'}); }
        } else if (action === 'release') this.releaseTerminalAgent(terminal);
        else if (action === 'heartbeat') { if (!terminal.agent) fail('Skippy lease expired.',409); terminal.agentHeartbeat = Date.now(); }
        else fail('Unknown launcher action.',404);
        reply({ok:true}); return true;
      }
      if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        if (!process.env.SKIPPY_ACCESS_TOKEN) checkAccess(req, '');
        res.writeHead(204, { 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, Authorization, X-Ide-Client, X-Room-Id, X-Room-Token' }); res.end(); return true;
      }
      checkAccess(req,(req.headers.authorization || '').replace(/^Bearer /,''));
      const parts = url.pathname.split('/').filter(Boolean).slice(1);
      if (parts[0] !== 'projects') fail('Unknown workspace endpoint.',404);
      if (parts.length === 1) {
        if (req.method === 'GET') reply({projects:this.store.list()});
        else if (req.method === 'POST') { const data = await body(req); reply(this.store.create(data.name,data.files || []),201); }
        else fail('Method not allowed.',405);
        return true;
      }
      const project = this.store.get(parts[1]);
      if (parts[2] === 'bind' && req.method === 'POST') {
        const {room,peerId} = this.member(req.headers['x-room-id'],req.headers['x-room-token']);
        this.bind(project,room,peerId); reply(this.store.snapshot(project)); return true;
      }
      const context = this.context(req,project);
      if (parts.length === 2 && req.method === 'GET') {
        let syncError = '';
        try { this.beforeAction(project,context); } catch (error) { if (error.status !== 409) throw error; syncError = error.message; }
        reply({ ...this.store.snapshot(project), syncError }); return true;
      }
      if (parts[2] === 'conflicts' && req.method === 'POST' && context.room) {
        const data = await body(req);
        const filename = this.store.resolve(project,data.path);
        const disk = fs.existsSync(filename) ? fs.readFileSync(filename,'utf8') : null;
        if (disk !== data.expectedDisk) fail('The disk version changed again. Review the latest conflict.',409);
        const file = [...context.room.sharedFiles.values()].find(f => f.name === data.path);
        if (!file) fail('Shared file no longer exists.',404);
        const text = this.getOrCreateDoc(`${context.room.roomId}/${file.id}`).doc.getText('monaco');
        if (data.useDisk) {
          if (disk === null) this.removeShared(context.room,file);
          else { text.doc.transact(() => { text.delete(0,text.length); text.insert(0,disk); }); context.room.diskBaseline.set(data.path,disk); }
        } else { const content = text.toString(); this.store.sync(project,[{path:data.path,previous:disk,content}]); context.room.diskBaseline.set(data.path,content); }
        reply(this.store.snapshot(project)); return true;
      }
      this.beforeAction(project,context);
      if (parts.length === 2 && req.method === 'GET') reply(this.store.snapshot(project));
      else if (parts[2] === 'delete-file' && req.method === 'POST') {
        const data = await body(req);
        if (context.room && context.room.hostId !== context.peerId) fail('Only the room host can delete project files.',403);
        if (project.agent) fail('Stop Skippy before deleting files.',409);
        this.store.sync(project,[{path:data.path,previous:data.previous,content:null}]);
        if (context.room) { const file = [...context.room.sharedFiles.values()].find(f => f.name === data.path); if (file) this.removeShared(context.room,file); }
        reply(this.store.snapshot(project));
      }
      else if (parts[2] === 'sync' && req.method === 'POST') {
        const data = await body(req);
        if (!context.room) this.store.sync(project,data.changes || []);
        else {
          this.store.validateChanges(data.changes || []);
          const shared = new Set([...context.room.sharedFiles.values()].map(f => f.name));
          const added = (data.changes || []).filter(f => !shared.has(f.path) && f.content !== null);
          if (added.length) {
            if (context.room.hostId !== context.peerId) fail('Only the room host can add project files.',403);
            this.store.sync(project,added); this.refreshRoom(context.room);
          }
        }
        project.activeFileId = data.activeFileId;
        if (data.config) project.config = {testCommand:String(data.config.testCommand || '').slice(0,1000)};
        this.store.persist(project); reply(this.store.snapshot(project));
      } else if (parts[2] === 'checkpoints' && req.method === 'POST' && parts.length === 3) {
        const data = await body(req); reply(this.store.checkpoint(project,data.label),201);
      } else if (parts[2] === 'checkpoints' && parts[4] === 'diff' && req.method === 'GET') reply({files:this.store.diff(project,parts[3])});
      else if (parts[2] === 'checkpoints' && parts[4] === 'restore' && req.method === 'POST') {
        if ([...this.terminals.values()].some(t => t.project.id === project.id && t.alive)) fail('Close terminal sessions before restoring so running commands cannot overwrite restored files.',409);
        const result = this.store.restore(project,parts[3]);
        if (context.room) this.refreshRoom(context.room,true);
        reply(result);
      } else if (parts[2] === 'agent' && req.method === 'POST') {
        const data = await body(req);
        if (data.action === 'claim') {
          if (context.room) { if (context.room.agentOwner !== context.peerId) fail('Claim the room agent before starting.',409); }
          else { if (project.agent) fail('Skippy is already running in this project.',409); this.store.checkpoint(project,'Before AI panel run'); project.agent = {owner:context.owner,kind:'panel',token:randomUUID(),heartbeat:Date.now()}; }
          reply({token:project.agent?.token || ''});
        } else if (data.action === 'heartbeat') { if (!context.room && equal(project.agent?.token,data.token) && project.agent?.owner === context.owner) project.agent.heartbeat = Date.now(); reply({ok:true});
        } else if (data.action === 'release') { if (!context.room && equal(project.agent?.token,data.token) && project.agent?.owner === context.owner) project.agent = null; reply({ok:true}); }
        else fail('Invalid agent action.');
      } else if (parts[2] === 'terminals' && req.method === 'GET') reply({terminals:[...this.terminals.values()].filter(t => t.project.id === project.id).map(t => this.info(t))});
      else fail('Unknown workspace endpoint.',404);
    } catch(error) { if (!res.headersSent && !res.destroyed) reply({error:error.message},error.status || 500); }
    return true;
  }
  info(t) { return {id:t.id,owner:t.owner,alive:t.alive,title:t.title,agent:t.agent,exitCode:t.exitCode}; }
  releaseTerminalAgent(t) {
    t.agent = false;
    if (t.project.agent?.owner === t.id) t.project.agent = null;
    const room = this.rooms.get(t.roomId);
    if (room?.agentOwner === 'terminal:'+t.id) { room.agentOwner = null; room.broadcastJson({type:'agent-owner',peerId:null}); }
    this.broadcast(t,{type:'terminal-state',terminal:this.info(t)});
  }
  broadcast(t,payload) { for (const ws of t.viewers.keys()) send(ws,payload); }
  kill(t) { if (t.alive) { t.alive = false; t.process.kill(); } this.releaseTerminalAgent(t); this.terminals.delete(t.id); this.broadcast(t,{type:'terminal-closed',id:t.id}); }
  handleTerminal(ws,req) {
    let authenticated = false, context = null, project = null, terminal = null;
    const timeout = setTimeout(() => ws.close(4001,'Authenticate first'),5000);
    ws.on('message', raw => {
      try {
        if (raw.length > 100000) fail('Terminal message too large.',413);
        const message = JSON.parse(raw.toString());
        if (!authenticated) {
          if (message.type !== 'authenticate') fail('Authenticate first.',401);
          checkAccess(req,message.accessToken || '');
          project = this.store.get(message.projectId);
          context = { ...this.context(req,project,message), roomToken:message.roomToken };
          authenticated = true; clearTimeout(timeout);
          send(ws,{type:'terminal-list',terminals:[...this.terminals.values()].filter(t=>t.project.id===project.id).map(t=>this.info(t)),owner:context.owner});
          return;
        }
        // Room membership can be revoked after this socket was authenticated.
        if (context.room) this.member(context.room.roomId,message.roomToken || context.roomToken);
        if (message.type === 'create') {
          if ([...this.terminals.values()].filter(t=>t.project.id===project.id).length >= 8) fail('Maximum eight terminal tabs per project.');
          if (this.terminals.size >= 32) fail('Terminal capacity reached.',429);
          if (project.agent) fail('Wait for Skippy to finish before opening another shell.',409);
          this.beforeAction(project,context);
          const env = Object.fromEntries(Object.entries(process.env).filter(([key,value]) => typeof value === 'string' && !/TOKEN|SECRET|API_KEY/i.test(key)));
          const python = process.env.SKIPPY_PYTHON || path.join(IDE_ROOT,'.venv310',process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
          const id = randomUUID(), launcherToken = randomUUID();
          const selectedProvider = ['ollama', 'gemini', 'openrouter'].includes(message.provider) ? message.provider : 'openrouter';
          Object.assign(env,{SKIPPY_PYTHON:python,PYTHONPATH:path.join(IDE_ROOT,'Skippy_harness'),PYTHONIOENCODING:'utf-8',TERM:'xterm-256color',SKIPPY_TERMINAL_TOKEN:launcherToken,SKIPPY_TERMINAL_URL:`http://127.0.0.1:${process.env.PORT || '4000'}/internal/terminal-agent`,PROVIDER:selectedProvider,MODEL:String(message.model || ''),OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY || String(message.apiKey || ''),GEMINI_API_KEY:process.env.GEMINI_API_KEY || '',OLLAMA_BASE_URL:process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'});
          let shell, args;
          if (process.platform === 'win32') {
            shell = 'powershell.exe';
            const startup = "function global:skippy { & $env:SKIPPY_PYTHON -u -m skippy_harness.ide_launcher @args }; Write-Host 'Workspace terminal ready. Type skippy to open the Python harness.'";
            args = ['-NoLogo','-NoProfile','-NoExit','-EncodedCommand',Buffer.from(startup,'utf16le').toString('base64')];
          } else {
            const bin = path.join(this.store.root,'bin'); fs.mkdirSync(bin,{recursive:true});
            fs.writeFileSync(path.join(bin,'skippy'),'#!/bin/sh\nexec "$SKIPPY_PYTHON" -u -m skippy_harness.ide_launcher "$@"\n',{mode:0o755});
            env.PATH = bin + path.delimiter + (env.PATH || ''); shell = process.env.SHELL || '/bin/bash'; args = ['-i'];
          }
          if (terminal) { terminal.viewers.delete(ws); terminal.lastSeen = Date.now(); }
          const processPty = pty.spawn(shell,args,{name:'xterm-256color',cols:80,rows:24,cwd:this.store.directory(project),env,useConpty:true});
          terminal = {id,project,process:processPty,launcherToken,roomId:context.room?.roomId || null,owner:context.owner,viewers:new Map(),buffer:'',alive:true,agent:false,agentHeartbeat:0,lastSeen:Date.now(),title:'Shell '+([...this.terminals.values()].filter(t=>t.project.id===project.id).length+1)};
          this.terminals.set(id,terminal);
          const created = terminal;
          processPty.onData(data => { created.buffer = (created.buffer + data).slice(-512000); this.broadcast(created,{type:'output',id:created.id,data}); });
          processPty.onExit(({exitCode}) => { created.alive = false; created.exitCode = exitCode; this.releaseTerminalAgent(created); this.broadcast(created,{type:'exit',id:created.id,exitCode}); });
          terminal.viewers.set(ws,context.owner);
          send(ws,{type:'attached',terminal:this.info(terminal),buffer:terminal.buffer});
          return;
        }
        if (message.type === 'attach') {
          const selected = this.terminals.get(message.id);
          if (!selected || selected.project.id !== project.id) fail('Terminal no longer exists.',404);
          if (terminal) { terminal.viewers.delete(ws); terminal.lastSeen = Date.now(); }
          terminal = selected; terminal.lastSeen = Date.now(); terminal.viewers.set(ws,context.owner);
          send(ws,{type:'attached',terminal:this.info(terminal),buffer:terminal.buffer}); return;
        }
        if (!terminal) fail('Select a terminal first.');
        if (message.type === 'claim') { if (terminal.owner && terminal.owner !== context.owner) fail('The current input owner must release control first.',409); terminal.owner = context.owner; this.broadcast(terminal,{type:'terminal-state',terminal:this.info(terminal)}); }
        else if (message.type === 'release') { if (terminal.owner !== context.owner) fail('Only the input owner can release control.',403); terminal.owner = null; this.broadcast(terminal,{type:'terminal-state',terminal:this.info(terminal)}); }
        else {
          if (terminal.owner !== context.owner) fail('This terminal is view-only. Take input control first.',403);
          if (message.type === 'input') {
            if (typeof message.data !== 'string' || message.data.length > 65536) fail('Invalid terminal input.');
            if (project.agent && project.agent.owner !== terminal.id) fail('Another Skippy run is active. Wait for it to finish.',409);
            if (!terminal.alive) fail('This shell has exited. Open a new tab.');
            this.beforeAction(project,context); terminal.process.write(message.data);
          } else if (message.type === 'resize') {
            if (!Number.isInteger(message.cols) || !Number.isInteger(message.rows) || message.cols < 2 || message.cols > 500 || message.rows < 2 || message.rows > 200) fail('Invalid terminal size.');
            if (terminal.alive) terminal.process.resize(message.cols,message.rows);
          } else if (message.type === 'close') this.kill(terminal);
          else fail('Unknown terminal command.');
        }
      } catch(error) { send(ws,{type:'error',message:error.message}); if (!authenticated) ws.close(4003,'Unauthorized'); }
    });
    ws.on('close',() => { clearTimeout(timeout); for (const session of this.terminals.values()) { session.viewers.delete(ws); if (session.project.id === project?.id && session.owner === context?.owner && ![...session.viewers.values()].includes(context?.owner)) { session.owner = null; session.lastSeen = Date.now(); this.broadcast(session,{type:'terminal-state',terminal:this.info(session)}); } } });
    ws.on('error',() => {});
  }
  dispose() { clearInterval(this.timer); for (const t of [...this.terminals.values()]) this.kill(t); }
}
