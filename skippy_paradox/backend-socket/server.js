/**
 * CodeCollab Socket Server — Real-time collaboration backend.
 *
 * Architecture:
 *   Two WebSocket paths per room:
 *     /room/:roomId       — Control channel (JSON): join, approve, file sharing
 *     /doc/:roomId/:fileId — Yjs channel (binary): doc sync + cursor awareness
 *
 * Each shared file gets its own Y.Doc on the server, keyed by "roomId/fileId".
 * The control channel manages room lifecycle and file metadata.
 */

import http from 'node:http';
import { IdeService } from './ide-service.js';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// ─── Constants ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4000', 10);
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// ─── In-memory state ──────────────────────────────────────────────────

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<WebSocket, Set<number>> }>} */
const docs = new Map();
const ide = new IdeService(rooms, docs, getOrCreateDoc);

// ─── Room ──────────────────────────────────────────────────────────────

class Room {
  constructor(roomId) {
    this.roomId = roomId;
    this.hostId = null;
    this.agentOwner = null;
    this.agentEvents = [];

    /** @type {Map<string, { ws: WebSocket, displayName: string, color: string }>} */
    this.members = new Map();

    /** @type {Map<string, { ws: WebSocket, displayName: string, color: string }>} */
    this.pending = new Map();

    /** @type {Map<string, { id: string, name: string, language: string, content: string }>} */
    this.sharedFiles = new Map();

    /** @type {Map<string, { inVoice: boolean, muted: boolean, deafened: boolean, speaking: boolean }>} */
    this.voiceStates = new Map();
  }

  broadcastJson(msg, excludePeerId = null) {
    const data = JSON.stringify(msg);
    for (const [pid, member] of this.members) {
      if (pid !== excludePeerId && member.ws.readyState === WebSocket.OPEN) {
        member.ws.send(data);
      }
    }
  }

  getMembersList() {
    return Array.from(this.members.entries()).map(([peerId, m]) => {
      const voice = this.voiceStates.get(peerId) || {
        inVoice: false,
        muted: false,
        deafened: false,
        speaking: false,
      };

      return {
        peerId,
        displayName: m.displayName,
        color: m.color,
        isHost: peerId === this.hostId,
        voice,
      };
    });
  }

  getPendingList() {
    return Array.from(this.pending.entries()).map(([peerId, p]) => ({
      peerId,
      displayName: p.displayName,
      color: p.color,
    }));
  }

  broadcastMembersUpdate() {
    this.broadcastJson({
      type: 'members-update',
      members: this.getMembersList(),
      pending: this.getPendingList(),
    });
  }

  getSharedFilesList() {
    return Array.from(this.sharedFiles.values()).map(f => ({
      id: f.id,
      name: f.name,
      language: f.language,
    }));
  }
}

// ─── Yjs Document Manager ──────────────────────────────────────────────

function getOrCreateDoc(docName) {
  let entry = docs.get(docName);
  if (entry) return entry;

  const doc = new Y.Doc({ gc: true });
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // server has no cursor

  // Clean up awareness when client disconnects (handled in closeConn)
  const conns = new Map();
  entry = { doc, awareness, conns };
  docs.set(docName, entry);

  return entry;
}

function seedDoc(docName, content) {
  const entry = getOrCreateDoc(docName);
  const ytext = entry.doc.getText('monaco');
  if (ytext.length === 0 && content) {
    ytext.insert(0, content);
  }
  return entry;
}

function closeDocConn(docName, ws) {
  const entry = docs.get(docName);
  if (!entry) return;

  const controlledIds = entry.conns.get(ws);
  entry.conns.delete(ws);

  // Remove awareness states owned by this connection
  if (controlledIds && controlledIds.size > 0) {
    awarenessProtocol.removeAwarenessStates(
      entry.awareness,
      Array.from(controlledIds),
      null,
    );
  }

  // If no more connections, GC after timeout
  if (entry.conns.size === 0) {
    setTimeout(() => {
      const current = docs.get(docName);
      if (current && current.conns.size === 0 && !rooms.has(docName.split('/')[0])) {
        current.awareness.destroy();
        current.doc.destroy();
        docs.delete(docName);
      }
    }, 30_000);
  }
}

// ─── Control Channel Handler ───────────────────────────────────────────

let peerCounter = 0;
function generatePeerId() {
  return `peer_${Date.now()}_${++peerCounter}`;
}

function handleControlConnection(ws, roomId) {
  const peerId = generatePeerId();
  ws.sessionToken = randomUUID();
  let room = rooms.get(roomId);
  let joined = false;

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    if (!joined) room = rooms.get(roomId);
    if (joined && (msg.type === 'create' || msg.type === 'join')) return;
    switch (msg.type) {
      // ── Create room (become host) ────────────────────────────
      case 'create': {
        if (room) {
          sendJson(ws, { type: 'error', message: 'Room already exists' });
          return;
        }
        room = new Room(roomId);
        room.hostId = peerId;
        room.members.set(peerId, {
          ws,
          displayName: msg.displayName || 'Host',
          color: msg.color || '#FF6B6B',
        });
        rooms.set(roomId, room);
        joined = true;

        sendJson(ws, { type: 'room-created', peerId, roomId, sessionToken: ws.sessionToken });
        room.broadcastMembersUpdate();
        break;
      }

      // ── Join room (request) ──────────────────────────────────
      case 'join': {
        if (!room) {
          sendJson(ws, { type: 'error', message: 'Room does not exist' });
          return;
        }
        // Add to pending
        room.pending.set(peerId, {
          ws,
          displayName: msg.displayName || 'Guest',
          color: msg.color || '#4ECDC4',
        });
        joined = true;

        sendJson(ws, { type: 'waiting-approval', peerId });

        // Notify host
        const host = room.members.get(room.hostId);
        if (host && host.ws.readyState === WebSocket.OPEN) {
          sendJson(host.ws, {
            type: 'join-request',
            peerId,
            displayName: msg.displayName,
            color: msg.color,
          });
        }
        room.broadcastMembersUpdate();
        break;
      }

      // ── Approve join ────────────────────────────────────────
      case 'approve': {
        if (!room || peerId !== room.hostId) return;
        const pendingMember = room.pending.get(msg.peerId);
        if (!pendingMember) return;

        room.pending.delete(msg.peerId);
        room.members.set(msg.peerId, pendingMember);

        // Send approval with list of shared files
        sendJson(pendingMember.ws, {
          type: 'approved',
          peerId: msg.peerId,
          sharedFiles: room.getSharedFilesList(),
          sessionToken: pendingMember.ws.sessionToken,
          agentOwner: room.agentOwner,
          agentEvents: room.agentEvents,
          workspaceId: room.workspaceId || null,
        });
        room.broadcastMembersUpdate();
        break;
      }

      // ── Reject join ─────────────────────────────────────────
      case 'reject': {
        if (!room || peerId !== room.hostId) return;
        const rejected = room.pending.get(msg.peerId);
        if (!rejected) return;

        room.pending.delete(msg.peerId);
        sendJson(rejected.ws, { type: 'rejected' });
        room.broadcastMembersUpdate();
        break;
      }

      // ── Share a file (host only) ────────────────────────────
      case 'agent-claim': {
        if (!room || !room.members.has(peerId)) return;
        if (room.agentOwner) {
          sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, error: 'Another collaborator is using the harness. Wait for their run to finish.' });
        } else {
          try { ide.roomClaim(room, peerId); } catch (error) { sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, error: error.message }); break; }
          room.agentOwner = peerId;
          room.broadcastJson({ type: 'agent-owner', peerId, displayName: room.members.get(peerId).displayName });
          sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, ok: true });
        }
        break;
      }
      case 'agent-release': {
        if (!room || room.agentOwner !== peerId) return;
        ide.roomRelease(room, peerId);
        room.agentOwner = null;
        room.broadcastJson({ type: 'agent-owner', peerId: null });
        break;
      }
      case 'agent-event': {
        if (!room || room.agentOwner !== peerId || !msg.event || typeof msg.event !== 'object') return;
        // Only user-visible activity crosses the room; never credentials or run tokens.
        const { type, content, message, name, result, status, id } = msg.event;
        if (!['user', 'message', 'status', 'tool', 'error', 'done'].includes(type)) return;
        const event = { type, content, message, name, result, status, id, author: room.members.get(peerId).displayName };
        if (JSON.stringify(event).length > 40000) return;
        const payload = { type: 'agent-event', peerId, event };
        room.agentEvents.push(payload);
        room.agentEvents = room.agentEvents.slice(-150);
        room.broadcastJson(payload, peerId);
        break;
      }
      case 'agent-edit': {
        if (!room || room.agentOwner !== peerId) return;
        const { path, content, previous } = msg;
        if (typeof path !== 'string' || typeof content !== 'string' || content.length > 1000000 || path.length > 500) return;
        const existing = Array.from(room.sharedFiles.values()).find(f => f.name === path);
        if (existing) {
          const entry = getOrCreateDoc(`${roomId}/${existing.id}`);
          const text = entry.doc.getText('monaco');
          if (text.toString() !== previous && text.toString() !== content) {
            sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, error: `Conflict in ${path}: a collaborator edited it during the run. Your edit is preserved for review.` });
            break;
          }
          if (text.toString() !== content) entry.doc.transact(() => { text.delete(0, text.length); text.insert(0, content); });
          existing.content = content;
          sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, ok: true, fileId: existing.id });
        } else if (previous !== null && previous !== undefined) {
          sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, error: `${path} was removed from this room. The agent edit was not applied.` });
        } else {
          const file = { id: randomUUID(), name: path, language: msg.language || 'plaintext', content };
          room.sharedFiles.set(file.id, file);
          seedDoc(`${roomId}/${file.id}`, content);
          room.broadcastJson({ type: 'file-shared', file: { id: file.id, name: path, language: file.language } });
          sendJson(ws, { type: 'agent-reply', requestId: msg.requestId, ok: true, fileId: file.id });
        }
        break;
      }
      case 'share-file': {
        if (!room || peerId !== room.hostId) return;
        const file = msg.file;
        if (!file || !file.id) return;
        if (room.sharedFiles.has(file.id)) return;
        if (Array.from(room.sharedFiles.values()).some(f => f.name === file.name)) {
          sendJson(ws, { type: 'error', message: 'A file with this path is already shared.' });
          return;
        }

        room.sharedFiles.set(file.id, {
          id: file.id,
          name: file.name || 'untitled',
          language: file.language || '',
          content: file.content || '',
        });

        // Seed the Y.Doc with the file content
        const docName = `${roomId}/${file.id}`;
        seedDoc(docName, file.content || '');

        // Notify all members
        room.broadcastJson({
          type: 'file-shared',
          file: { id: file.id, name: file.name, language: file.language },
        });
        break;
      }

      // ── Reorder shared files (host only) ──────────────────────
      case 'reorder-files': {
        if (!room || peerId !== room.hostId) return;
        const newFilesList = msg.files;
        if (!Array.isArray(newFilesList)) return;

        const oldMap = room.sharedFiles;
        const newMap = new Map();
        for (const f of newFilesList) {
          const existing = oldMap.get(f.id);
          if (existing) {
            newMap.set(f.id, existing);
          }
        }
        room.sharedFiles = newMap;

        // Notify all members of the new order
        room.broadcastJson({
          type: 'files-reordered',
          sharedFiles: room.getSharedFilesList(),
        });
        break;
      }

      // ── Unshare a file (host only) ──────────────────────────
      case 'unshare-file': {
        if (!room || peerId !== room.hostId) return;
        if (room.workspaceId) { sendJson(ws, { type:'workspace-error', message:'Saved project files are shared with the room. Delete the project file to remove it, or leave the room to work privately.' }); break; }
        const fileId = msg.fileId;
        if (!fileId || !room.sharedFiles.has(fileId)) return;

        room.sharedFiles.delete(fileId);

        // Notify all members
        room.broadcastJson({ type: 'file-unshared', fileId });

        // Clean up the Y.Doc
        const dName = `${roomId}/${fileId}`;
        const entry = docs.get(dName);
        if (entry) {
          // Close all connections to this doc
          for (const [conn] of entry.conns) {
            conn.close();
          }
          entry.awareness.destroy();
          entry.doc.destroy();
          docs.delete(dName);
        }
        break;
      }

      // ── Chat message ──────────────────────────────────────
      case 'chat-message': {
        if (!room || !room.members.has(peerId)) return;
        const text = (msg.text || '').trim();
        if (!text) return;

        const member = room.members.get(peerId);
        const chatMsg = {
          type: 'chat-message',
          id: `chat_${Date.now()}_${++peerCounter}`,
          peerId,
          displayName: member.displayName,
          color: member.color,
          text,
          timestamp: Date.now(),
        };
        // Broadcast to ALL members (including sender for confirmation)
        const data = JSON.stringify(chatMsg);
        for (const [, m] of room.members) {
          if (m.ws.readyState === WebSocket.OPEN) {
            m.ws.send(data);
          }
        }
        break;
      }

      // ── Voice lobby: join ───────────────────────────────────
      case 'voice-join': {
        if (!room || !room.members.has(peerId)) return;
        const prev = room.voiceStates.get(peerId);
        room.voiceStates.set(peerId, {
          inVoice: true,
          muted: prev?.muted ?? false,
          deafened: prev?.deafened ?? false,
          speaking: false,
        });
        room.broadcastMembersUpdate();
        break;
      }

      // ── Voice lobby: leave ──────────────────────────────────
      case 'voice-leave': {
        if (!room || !room.members.has(peerId)) return;
        const prev = room.voiceStates.get(peerId);
        room.voiceStates.set(peerId, {
          inVoice: false,
          muted: prev?.muted ?? false,
          deafened: prev?.deafened ?? false,
          speaking: false,
        });
        room.broadcastMembersUpdate();
        break;
      }

      // ── Voice lobby: mute/deafen state ──────────────────────
      case 'voice-state': {
        if (!room || !room.members.has(peerId)) return;
        const prev = room.voiceStates.get(peerId) || {
          inVoice: false,
          muted: false,
          deafened: false,
          speaking: false,
        };

        room.voiceStates.set(peerId, {
          ...prev,
          muted: Boolean(msg.muted),
          deafened: Boolean(msg.deafened),
          speaking: prev.inVoice ? prev.speaking : false,
        });
        room.broadcastMembersUpdate();
        break;
      }

      // ── Voice lobby: speaking signal ────────────────────────
      case 'voice-speaking': {
        if (!room || !room.members.has(peerId)) return;
        const prev = room.voiceStates.get(peerId);
        if (!prev || !prev.inVoice) return;

        const canSpeak = !prev.muted && !prev.deafened;
        room.voiceStates.set(peerId, {
          ...prev,
          speaking: canSpeak ? Boolean(msg.speaking) : false,
        });
        room.broadcastMembersUpdate();
        break;
      }

      // ── WebRTC signaling: relay offer to target peer ───────
      case 'voice-offer': {
        if (!room || !room.members.has(peerId)) return;
        const target = room.members.get(msg.targetPeerId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, { type: 'voice-offer', fromPeerId: peerId, sdp: msg.sdp });
        }
        break;
      }

      // ── WebRTC signaling: relay answer to target peer ──────
      case 'voice-answer': {
        if (!room || !room.members.has(peerId)) return;
        const target = room.members.get(msg.targetPeerId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, { type: 'voice-answer', fromPeerId: peerId, sdp: msg.sdp });
        }
        break;
      }

      // ── WebRTC signaling: relay ICE candidate ──────────────
      case 'voice-ice-candidate': {
        if (!room || !room.members.has(peerId)) return;
        const target = room.members.get(msg.targetPeerId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, { type: 'voice-ice-candidate', fromPeerId: peerId, candidate: msg.candidate });
        }
        break;
      }

      // ── Leave ───────────────────────────────────────────────
      case 'leave': {
        handleDisconnect(ws, peerId, room);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (joined && room) {
      handleDisconnect(ws, peerId, room);
    }
  });

  ws.on('error', () => {
    if (joined && room) {
      handleDisconnect(ws, peerId, room);
    }
  });
}

function handleDisconnect(ws, peerId, room) {
  if (!room) return;
  if (room.agentOwner === peerId) {
    ide.roomRelease(room, peerId);
    room.agentOwner = null;
    room.broadcastJson({ type: 'agent-owner', peerId: null });
  }
  for (const file of room.sharedFiles.values()) {
    const entry = docs.get(`${room.roomId}/${file.id}`);
    if (entry) for (const [conn] of entry.conns) {
      if (conn.sessionToken === ws.sessionToken) conn.close(4003, 'Room membership ended');
    }
  }

  const wasMember = room.members.has(peerId);
  const member = room.members.get(peerId);
  const displayName = member?.displayName || room.pending.get(peerId)?.displayName || 'Unknown';

  room.members.delete(peerId);
  room.pending.delete(peerId);
  room.voiceStates.delete(peerId);

  if (wasMember) {
    room.broadcastJson({ type: 'peer-left', peerId, displayName });
  }

  // If host left
  if (peerId === room.hostId) {
    if (room.members.size > 0) {
      // Promote first member to host
      const [newHostId] = room.members.keys();
      room.hostId = newHostId;
      const newHost = room.members.get(newHostId);
      if (newHost && newHost.ws.readyState === WebSocket.OPEN) {
        sendJson(newHost.ws, { type: 'promoted-to-host' });
      }
      room.broadcastMembersUpdate();
    } else {
      // Room empty — clean up
      // Reject all pending
      for (const [, p] of room.pending) {
        sendJson(p.ws, { type: 'room-closed' });
      }
      room.pending.clear();

      // Clean up all shared file docs
      for (const [fileId] of room.sharedFiles) {
        const dName = `${room.roomId}/${fileId}`;
        const entry = docs.get(dName);
        if (entry) {
          for (const [conn] of entry.conns) {
            conn.close();
          }
          entry.awareness.destroy();
          entry.doc.destroy();
          docs.delete(dName);
        }
      }
      rooms.delete(room.roomId);
    }
  } else {
    room.broadcastMembersUpdate();
  }
}

function sendJson(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ─── Yjs Document Channel Handler ──────────────────────────────────────

function handleDocConnection(ws, roomId, fileId, sessionToken) {
  const docName = `${roomId}/${fileId}`;
  const room = rooms.get(roomId);

  // Verify room exists and file is shared
  if (!room || !room.sharedFiles.has(fileId) || !Array.from(room.members.values()).some(m => m.ws.sessionToken === sessionToken)) {
    ws.close(4001, 'File not shared');
    return;
  }
  ws.sessionToken = sessionToken;

  const entry = getOrCreateDoc(docName);
  const { doc, awareness, conns } = entry;

  conns.set(ws, new Set());

  // ── Send initial sync ──────────────────────────────────────
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  }

  // Send current awareness state
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        Array.from(awarenessStates.keys()),
      ),
    );
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  }

  // ── Handle incoming messages ───────────────────────────────
  ws.on('message', (rawData, isBinary) => {
    if (!isBinary) return; // Only accept binary

    const data = new Uint8Array(rawData);
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);

        // Send reply (syncStep2) back to sender if any
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder), { binary: true });
        }
        // Doc update handler below broadcasts to other clients automatically
        break;
      }

      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);

        // Track which awareness client IDs this connection controls
        // so we can clean them up on disconnect
        const controlledIds = conns.get(ws);
        if (controlledIds) {
          // Parse the awareness update to extract client IDs
          const decoder2 = decoding.createDecoder(update);
          const len = decoding.readVarUint(decoder2);
          for (let i = 0; i < len; i++) {
            const clientID = decoding.readVarUint(decoder2);
            controlledIds.add(clientID);
            // Skip the clock and state data
            decoding.readVarUint(decoder2);
            decoding.readVarString(decoder2);
          }
        }
        // Awareness update handler below broadcasts to other clients
        break;
      }
    }
  });

  // ── Listen for doc updates and broadcast ───────────────────
  const updateHandler = (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);

    if (ws !== origin && ws.readyState === WebSocket.OPEN) ws.send(msg, { binary: true });
  };
  doc.on('update', updateHandler);

  // ── Listen for awareness changes ───────────────────────────
  const awarenessHandler = ({ added, updated, removed }, origin) => {
    const changedClients = [...added, ...updated, ...removed];
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    );
    const msg = encoding.toUint8Array(encoder);

    if (ws !== origin && ws.readyState === WebSocket.OPEN) ws.send(msg, { binary: true });
  };
  awareness.on('update', awarenessHandler);

  // ── Clean up on close ──────────────────────────────────────
  ws.on('close', () => {
    doc.off('update', updateHandler);
    awareness.off('update', awarenessHandler);
    closeDocConn(docName, ws);
  });

  ws.on('error', () => {
    doc.off('update', updateHandler);
    awareness.off('update', awarenessHandler);
    closeDocConn(docName, ws);
  });
}



// ─── HTTP Server + WebSocket Routing ───────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Apply CORS before workspace routes, including their preflight requests.
  const allowedOrigins = (process.env.FRONTEND_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.length ? origin : '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Ide-Client, X-Room-Id, X-Room-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (await ide.handleHttp(req, res)) return;

  // Simple health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      docs: docs.size,
    }));
    return;
  }

  // Direct Code Execution Endpoint
  if (req.url === '/execute' && req.method === 'POST') {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use /api/judge0/execute on the IDE server.' }));
    return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { source_code, language, stdin } = JSON.parse(body || '{}');
        const lang = (language || 'javascript').toLowerCase();
        const startTime = Date.now();

        // 1. Python Execution
        if (lang === 'python' || lang === 'py') {
          const { spawn } = await import('node:child_process');
          const py = spawn('python', ['-c', source_code]);
          let stdout = '';
          let stderr = '';

          if (stdin) {
            py.stdin.write(stdin);
            py.stdin.end();
          }

          py.stdout.on('data', data => { stdout += data.toString(); });
          py.stderr.on('data', data => { stderr += data.toString(); });

          py.on('close', code => {
            const time = ((Date.now() - startTime) / 1000).toFixed(3) + 's';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              stdout: stdout || null,
              stderr: stderr || null,
              compile_output: null,
              message: null,
              status: { id: code === 0 ? 3 : 4, description: code === 0 ? 'Accepted' : 'Error' },
              time,
              memory: 1024,
            }));
          });

          py.on('error', err => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              stdout: null,
              stderr: `Execution error: ${err.message}`,
              status: { id: 4, description: 'Error' },
              time: '0.0s',
            }));
          });
          return;
        }

        // 2. JavaScript / Node execution
        const { spawn } = await import('node:child_process');
        const node = spawn('node', ['-e', source_code]);
        let stdout = '';
        let stderr = '';

        if (stdin) {
          node.stdin.write(stdin);
          node.stdin.end();
        }

        node.stdout.on('data', data => { stdout += data.toString(); });
        node.stderr.on('data', data => { stderr += data.toString(); });

        node.on('close', code => {
          const time = ((Date.now() - startTime) / 1000).toFixed(3) + 's';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            stdout: stdout || null,
            stderr: stderr || null,
            compile_output: null,
            message: null,
            status: { id: code === 0 ? 3 : 4, description: code === 0 ? 'Accepted' : 'Error' },
            time,
            memory: 1024,
          }));
        });

        node.on('error', err => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            stdout: null,
            stderr: `Execution error: ${err.message}`,
            status: { id: 4, description: 'Error' },
            time: '0.0s',
          }));
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/terminal') {
    wss.handleUpgrade(req, socket, head, ws => ide.handleTerminal(ws, req));
    return;
  }

  // /room/:roomId — Control channel
  const roomMatch = pathname.match(/^\/room\/([^/]+)$/);
  if (roomMatch) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const roomId = decodeURIComponent(roomMatch[1]);
      handleControlConnection(ws, roomId);
    });
    return;
  }

  // /doc/:roomId/:fileId — Yjs document channel
  const docMatch = pathname.match(/^\/doc\/([^/]+)\/([^/]+)$/);
  if (docMatch) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const roomId = decodeURIComponent(docMatch[1]);
      const fileId = decodeURIComponent(docMatch[2]);
      handleDocConnection(ws, roomId, fileId, url.searchParams.get('token'));
    });
    return;
  }

  // Unknown path
  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`⚡ CodeCollab Socket Server running on port ${PORT}`);
  console.log(`   Control:  ws://localhost:${PORT}/room/:roomId`);
  console.log(`   Yjs Doc:  ws://localhost:${PORT}/doc/:roomId/:fileId`);
});

process.on('SIGTERM', () => { ide.dispose(); server.close(); process.exit(0); });
process.on('SIGINT', () => { ide.dispose(); server.close(); process.exit(0); });
