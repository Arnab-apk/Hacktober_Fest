import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from '../skippy_paradox/backend-socket/node_modules/ws/wrapper.mjs';
import * as Y from '../skippy_paradox/backend-socket/node_modules/yjs/dist/yjs.mjs';
import * as sync from '../skippy_paradox/backend-socket/node_modules/y-protocols/sync.js';
import * as encoding from '../skippy_paradox/backend-socket/node_modules/lib0/encoding.js';
import * as decoding from '../skippy_paradox/backend-socket/node_modules/lib0/decoding.js';
import { WorkspaceStore, relativePath } from '../skippy_paradox/backend-socket/workspaces.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'skippy-workspace-test-'));
  t.after(() => { const resolved=path.resolve(temp); assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)); fs.rmSync(resolved,{recursive:true,force:true}); });
  return temp;
}
test('projects survive restart and stale editor batches never overwrite terminal edits', t => {
  const directory=fixture(t);let store=new WorkspaceStore(directory);
  const snapshot=store.create('Project',[{path:'src/main.py',content:'original'},{path:'notes.txt',content:'notes'}]);
  const project=store.get(snapshot.project.id);
  store.sync(project,[{path:'src/main.py',previous:'original',content:'editor saved'}]);
  fs.writeFileSync(path.join(store.directory(project),'src/main.py'),'terminal saved');
  assert.throws(()=>store.sync(project,[{path:'notes.txt',previous:'notes',content:'must not apply'},{path:'src/main.py',previous:'editor saved',content:'stale'}]),/changed on disk/);
  assert.equal(fs.readFileSync(path.join(store.directory(project),'notes.txt'),'utf8'),'notes');
  const id=project.id, fileId=store.snapshot(project).files.find(f=>f.path==='src/main.py').id;
  store=new WorkspaceStore(directory);
  assert.equal(store.get(id).name,'Project');
  assert.equal(store.snapshot(store.get(id)).files.find(f=>f.path==='src/main.py').content,'terminal saved');
  assert.equal(store.snapshot(store.get(id)).files.find(f=>f.path==='src/main.py').id,fileId);
});
test('checkpoints recover text, binary files, deletions, and the state before restoring',t=>{
  const store=new WorkspaceStore(fixture(t));const project=store.get(store.create('Recovery',[{path:'main.py',content:'before'}]).project.id);
  fs.writeFileSync(path.join(store.directory(project),'asset.bin'),Buffer.from([0,1,2,255]));
  const before=store.checkpoint(project,'Before changes');
  store.sync(project,[{path:'main.py',previous:'before',content:'after'},{path:'new.txt',previous:null,content:'new'}]);
  fs.unlinkSync(path.join(store.directory(project),'asset.bin'));
  assert.deepEqual(store.diff(project,before.id).map(f=>[f.path,f.status]).sort(),[['asset.bin','deleted'],['main.py','modified'],['new.txt','added']]);
  const result=store.restore(project,before.id);
  assert.equal(fs.readFileSync(path.join(store.directory(project),'main.py'),'utf8'),'before');
  assert.deepEqual(fs.readFileSync(path.join(store.directory(project),'asset.bin')),Buffer.from([0,1,2,255]));
  assert.equal(fs.existsSync(path.join(store.directory(project),'new.txt')),false);
  store.restore(project,result.recoveryCheckpoint);
  assert.equal(fs.readFileSync(path.join(store.directory(project),'main.py'),'utf8'),'after');
  assert.equal(fs.readFileSync(path.join(store.directory(project),'new.txt'),'utf8'),'new');
});
test('workspace writes reject traversal, reserved paths, duplicate paths, and symlinks',t=>{
  for(const filename of ['../outside','/absolute','C:/outside','a/../../b','node_modules/a','CON.txt','name.','a\\..\\b'])assert.throws(()=>relativePath(filename));
  const store=new WorkspaceStore(fixture(t));
  assert.throws(()=>store.create('duplicates',[{path:'File.txt',content:'a'},{path:'file.txt',content:'b'}]),/Duplicate/);
  const project=store.get(store.create('safe').project.id);
  const outside=path.join(store.root,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(store.directory(project),'link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>store.sync(project,[{path:'link/escape.txt',previous:null,content:'escape'}]),/Symbolic links/);
  assert.equal(fs.existsSync(path.join(outside,'escape.txt')),false);
});
test('UTF-8 BOM files round-trip through optimistic saves',t=>{
  const store=new WorkspaceStore(fixture(t));const project=store.get(store.create('BOM').project.id);
  fs.writeFileSync(path.join(store.directory(project),'bom.py'),'\uFEFFprint("before")');
  const before=store.snapshot(project).files[0].content;
  assert.equal(before,'\uFEFFprint("before")');
  store.sync(project,[{path:'bom.py',previous:before,content:'print("after")'}]);
  assert.equal(fs.readFileSync(path.join(store.directory(project),'bom.py'),'utf8'),'print("after")');
});

async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function socket(url,initial){
  const ws=new WebSocket(url);const messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const client={ws,messages,send:data=>ws.send(JSON.stringify(data)),wait:async(type,predicate=()=>true)=>{
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){const index=messages.findIndex(m=>m.type===type&&predicate(m));if(index>=0)return messages.splice(index,1)[0];await new Promise(resolve=>setTimeout(resolve,25));}
    throw new Error('Timed out waiting for '+type+': '+JSON.stringify(messages));
  }};
  if(initial)client.send(initial);
  return client;
}
async function document(url){
  const doc=new Y.Doc(),ws=new WebSocket(url);let resolveSync;
  const synced=new Promise(resolve=>resolveSync=resolve);
  ws.on('message',raw=>{
    const decoder=decoding.createDecoder(new Uint8Array(raw));if(decoding.readVarUint(decoder)!==0)return;
    const encoder=encoding.createEncoder();encoding.writeVarUint(encoder,0);
    const type=sync.readSyncMessage(decoder,encoder,doc,ws);
    if(encoding.length(encoder)>1)ws.send(encoding.toUint8Array(encoder));
    if(type===sync.messageYjsSyncStep2)resolveSync();
  });
  doc.on('update',(update,origin)=>{if(origin===ws)return;const encoder=encoding.createEncoder();encoding.writeVarUint(encoder,0);sync.writeUpdate(encoder,update);ws.send(encoding.toUint8Array(encoder));});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const encoder=encoding.createEncoder();encoding.writeVarUint(encoder,0);sync.writeSyncStep1(encoder,doc);ws.send(encoding.toUint8Array(encoder));await synced;
  return{ws,doc,text:doc.getText('monaco')};
}
test('real Windows PTY: shell input, disk sync, Skippy CLI, reconnect, ownership, and room locking', {timeout:70000,skip:process.platform!=='win32'}, async t=>{
  const directory=fixture(t),port=await freePort(),token='workspace-test-access';
  const server=spawn(process.execPath,['server.js'],{cwd:path.join(root,'skippy_paradox/backend-socket'),env:{...process.env,PORT:String(port),SKIPPY_WORKSPACE_ROOT:directory,SKIPPY_ACCESS_TOKEN:token},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  t.after(async()=>{server.kill();await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(resolve,2000).unref();}});});
  const base=`http://127.0.0.1:${port}`,clientId='test-client-123456';
  for(let attempt=0;attempt<80;attempt++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(server.exitCode!==null)throw new Error(logs);await new Promise(resolve=>setTimeout(resolve,50));}
  const request=async(route,data,extra={})=>{const response=await fetch(base+'/workspace-api'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Ide-Client':clientId,...extra},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,data:await response.json()};};
  const snapshot=(await request('/projects',{name:'PTY test',files:[{path:'main.py',content:'editor baseline'}]})).data;
  const id=snapshot.project.id;
  const auth={type:'authenticate',projectId:id,clientId,accessToken:token};
  const owner=await socket(`ws://127.0.0.1:${port}/terminal`,auth);t.after(()=>owner.ws.close());
  await owner.wait('terminal-list');owner.send({type:'create',provider:'ollama',model:'fake'});
  const attached=await owner.wait('attached');const terminalId=attached.terminal.id;
  assert.equal(attached.terminal.alive,true);assert.equal(attached.terminal.owner,clientId);
  let output='';owner.ws.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='output')output+=msg.data;});
  const waitOutput=async(pattern)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(pattern.test(output))return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('PTY output did not match '+pattern+': '+output);};
  await waitOutput(/Workspace terminal ready/);
  owner.send({type:'resize',cols:110,rows:25});
  owner.send({type:'input',data:"Set-Content -LiteralPath 'main.py' -Value 'terminal file changed'; Write-Output ('DONE' + '-DISK')\r"});
  await waitOutput(/DONE-DISK/);
  assert.match((await request(`/projects/${id}`)).data.files.find(f=>f.path==='main.py').content,/terminal file changed/);
  const disk=(await request(`/projects/${id}`)).data.files.find(f=>f.path==='main.py').content;
  assert.equal((await request(`/projects/${id}/sync`,{changes:[{path:'main.py',previous:disk,content:'editor-to-terminal-visible'}]})).status,200);
  owner.send({type:'input',data:"Get-Content -LiteralPath 'main.py'\r"});await waitOutput(/editor-to-terminal-visible/);
  owner.send({type:'input',data:'skippy --help\r'});await waitOutput(/continue the last session/);
  assert.match(output,/--provider/);assert.match(output,/--model/);
  assert.ok((await request(`/projects/${id}`)).data.checkpoints.some(c=>c.label==='Before terminal Skippy run'));
  const viewer=await socket(`ws://127.0.0.1:${port}/terminal`,{...auth,clientId:'test-viewer-123456'});t.after(()=>viewer.ws.close());await viewer.wait('terminal-list');viewer.send({type:'attach',id:terminalId});await viewer.wait('attached');
  viewer.send({type:'input',data:'echo forbidden\r'});assert.match((await viewer.wait('error')).message,/view-only/);
  viewer.send({type:'claim'});assert.match((await viewer.wait('error')).message,/release control/);
  owner.send({type:'release'});await owner.wait('terminal-state',m=>m.terminal.owner===null);
  viewer.send({type:'claim'});await viewer.wait('terminal-state',m=>m.terminal.owner==='test-viewer-123456');
  const restore=(await request(`/projects/${id}/checkpoints/${(await request(`/projects/${id}`)).data.checkpoints[0].id}/restore`,{}));assert.equal(restore.status,409);
  viewer.ws.close();owner.ws.close();await new Promise(resolve=>setTimeout(resolve,150));
  const resumed=await socket(`ws://127.0.0.1:${port}/terminal`,auth);t.after(()=>resumed.ws.close());assert.ok((await resumed.wait('terminal-list')).terminals.some(t=>t.id===terminalId&&t.alive));resumed.send({type:'attach',id:terminalId});assert.match((await resumed.wait('attached')).buffer,/editor-to-terminal-visible/);resumed.send({type:'claim'});await resumed.wait('terminal-state',m=>m.terminal.owner===clientId);resumed.send({type:'close'});await resumed.wait('terminal-closed');
  const roomName='workspace-room-'+Date.now();const host=await socket(`ws://127.0.0.1:${port}/room/${roomName}`);t.after(()=>host.ws.close());host.send({type:'create',displayName:'Host'});const created=await host.wait('room-created');const headers={'X-Room-Id':roomName,'X-Room-Token':created.sessionToken};
  const bound=await request(`/projects/${id}/bind`,{},headers);assert.equal(bound.status,200);
  const file=bound.data.files.find(f=>f.path==='main.py');
  const sharedDoc=await document(`ws://127.0.0.1:${port}/doc/${roomName}/${file.id}?token=${created.sessionToken}`);t.after(()=>{sharedDoc.ws.close();sharedDoc.doc.destroy();});
  sharedDoc.doc.transact(()=>{sharedDoc.text.delete(0,sharedDoc.text.length);sharedDoc.text.insert(0,'unsaved human');});
  await new Promise(resolve=>setTimeout(resolve,100));
  fs.writeFileSync(path.join(snapshot.project.directory,'main.py'),'disk conflict');
  const conflicted=await request(`/projects/${id}`,undefined,headers);assert.equal(conflicted.status,200);assert.match(conflicted.data.syncError,/Concurrent/);assert.equal(sharedDoc.text.toString(),'unsaved human');
  assert.equal((await request(`/projects/${id}/conflicts`,{path:'main.py',useDisk:true,expectedDisk:'disk conflict'},headers)).status,200);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(sharedDoc.text.toString(),'disk conflict');
  sharedDoc.text.insert(sharedDoc.text.length,' + keep human');await new Promise(resolve=>setTimeout(resolve,100));
  fs.writeFileSync(path.join(snapshot.project.directory,'main.py'),'second disk conflict');
  assert.equal((await request(`/projects/${id}/conflicts`,{path:'main.py',useDisk:false,expectedDisk:'second disk conflict'},headers)).status,200);
  assert.equal(fs.readFileSync(path.join(snapshot.project.directory,'main.py'),'utf8'),'disk conflict + keep human');
  const shared=await socket(`ws://127.0.0.1:${port}/terminal`,{...auth,roomId:roomName,roomToken:created.sessionToken});t.after(()=>shared.ws.close());await shared.wait('terminal-list');shared.send({type:'create',provider:'ollama'});const sharedAttached=await shared.wait('attached');
  // Exercise the same lease endpoint the Python launcher uses without an API/model call.
  shared.send({type:'input',data:"Invoke-RestMethod -Method Post -Uri ($env:SKIPPY_TERMINAL_URL + '/claim') -ContentType 'application/json' -Body (@{token=$env:SKIPPY_TERMINAL_TOKEN}|ConvertTo-Json) | Out-Null\r"});
  await host.wait('agent-owner',m=>String(m.peerId).startsWith('terminal:'));
  host.send({type:'agent-claim',requestId:'blocked'});assert.match((await host.wait('agent-reply')).error,/Another collaborator/);
  shared.send({type:'input',data:"Invoke-RestMethod -Method Post -Uri ($env:SKIPPY_TERMINAL_URL + '/release') -ContentType 'application/json' -Body (@{token=$env:SKIPPY_TERMINAL_TOKEN}|ConvertTo-Json) | Out-Null\r"});
  await host.wait('agent-owner',m=>m.peerId===null);
  host.send({type:'agent-claim',requestId:'panel'});assert.equal((await host.wait('agent-reply')).ok,true);
  shared.send({type:'input',data:'echo blocked-by-panel\r'});assert.match((await shared.wait('error')).message,/Another Skippy run/);
  host.send({type:'agent-release'});await host.wait('agent-owner',m=>m.peerId===null);
  shared.send({type:'close'});await shared.wait('terminal-closed');
  assert.equal((await fetch(base+'/workspace-api/projects')).status,401);
  console.log('Verified real ConPTY shell, Python CLI help, editor/disk sync, persistence, input ownership, and room agent exclusion.');
});
