import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from '../skippy_paradox/backend-socket/node_modules/ws/wrapper.mjs';
import * as Y from '../skippy_paradox/backend-socket/node_modules/yjs/dist/yjs.mjs';
import * as sync from '../skippy_paradox/backend-socket/node_modules/y-protocols/sync.js';
import * as encoding from '../skippy_paradox/backend-socket/node_modules/lib0/encoding.js';
import * as decoding from '../skippy_paradox/backend-socket/node_modules/lib0/decoding.js';

const base = process.env.COLLAB_TEST_URL || 'ws://127.0.0.1:4100';
async function control(room) {
  const ws = new WebSocket(`${base}/room/${room}`);
  const messages = [];
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, send: data => ws.send(JSON.stringify(data)), wait: async type => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const i = messages.findIndex(m => m.type === type);
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`Timed out waiting for ${type}`);
  }};
}
async function document(room, file, token) {
  const doc = new Y.Doc();
  const ws = new WebSocket(`${base}/doc/${room}/${file}?token=${token}`);
  let resolveSync;
  const synced = new Promise(r => resolveSync = r);
  ws.on('message', data => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    if (decoding.readVarUint(decoder) !== 0) return;
    const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0);
    const type = sync.readSyncMessage(decoder, encoder, doc, ws);
    if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
    if (type === sync.messageYjsSyncStep2) resolveSync();
  });
  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); sync.writeUpdate(encoder, update); ws.send(encoding.toUint8Array(encoder));
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); sync.writeSyncStep1(encoder, doc); ws.send(encoding.toUint8Array(encoder));
  await synced;
  return { doc, ws, text: doc.getText('monaco') };
}
test('two approved collaborators synchronize agent edits, protect conflicts, and release the room lock', { timeout: 15000 }, async () => {
  const room = 'test-' + Date.now();
  const host = await control(room), guest = await control(room);
  let hdoc, gdoc;
  try {
    host.send({ type: 'create', displayName: 'Alice' });
    const created = await host.wait('room-created');
    guest.send({ type: 'join', displayName: 'Bob' });
    const waiting = await guest.wait('waiting-approval');
    host.send({ type: 'approve', peerId: waiting.peerId });
    const approved = await guest.wait('approved');
    host.send({ type: 'share-file', file: { id: 'file1', name: 'src/main.py', language: 'python', content: 'original' } });
    await guest.wait('file-shared');
    hdoc = await document(room, 'file1', created.sessionToken);
    gdoc = await document(room, 'file1', approved.sessionToken);
    assert.equal(gdoc.text.toString(), 'original');
    guest.send({ type: 'agent-claim', requestId: 'claim' });
    assert.equal((await guest.wait('agent-reply')).ok, true);
    host.send({ type: 'agent-claim', requestId: 'busy' });
    assert.match((await host.wait('agent-reply')).error, /Another collaborator/);
    guest.send({ type: 'agent-edit', requestId: 'edit', path: 'src/main.py', previous: 'original', content: 'agent edit' });
    assert.equal((await guest.wait('agent-reply')).ok, true);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(hdoc.text.toString(), 'agent edit');
    assert.equal(gdoc.text.toString(), 'agent edit');
    hdoc.text.insert(hdoc.text.length, ' + human');
    await new Promise(r => setTimeout(r, 100));
    guest.send({ type: 'agent-edit', requestId: 'conflict', path: 'src/main.py', previous: 'agent edit', content: 'overwrite' });
    assert.match((await guest.wait('agent-reply')).error, /Conflict/);
    assert.equal(gdoc.text.toString(), 'agent edit + human');
    guest.send({ type: 'agent-edit', requestId: 'new', path: 'new.txt', previous: null, content: '' });
    assert.equal((await guest.wait('agent-reply')).ok, true);
    assert.equal((await host.wait('file-shared')).file.name, 'src/main.py');
    assert.equal((await host.wait('file-shared')).file.name, 'new.txt');
    guest.send({ type: 'agent-event', event: { type: 'message', content: 'Finished', token: 'must-not-leak' } });
    const event = await host.wait('agent-event');
    assert.equal(event.event.content, 'Finished'); assert.equal(event.event.token, undefined);
    guest.ws.close();
    await new Promise(r => setTimeout(r, 100));
    host.send({ type: 'agent-claim', requestId: 'after-disconnect' });
    assert.equal((await host.wait('agent-reply')).ok, true);
    const unauthorized = new WebSocket(`${base}/doc/${room}/file1?token=wrong`);
    const code = await new Promise(resolve => unauthorized.once('close', resolve));
    assert.equal(code, 4001);
  } finally {
    hdoc?.ws.close(); gdoc?.ws.close(); host.ws.close(); guest.ws.close(); hdoc?.doc.destroy(); gdoc?.doc.destroy();
  }
});
