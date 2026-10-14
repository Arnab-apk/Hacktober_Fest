/**
 * CollabService — WebSocket client for the Node.js collab socket server.
 *
 * Two connection types:
 *   1. Control channel (JSON) at /collab-ws/room/:roomId
 *      → Room lifecycle, join/approve, file sharing management
 *   2. Yjs doc channel (binary) at /collab-ws/doc/:roomId/:fileId
 *      → Per-file document sync + cursor awareness via y-protocols
 */

import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// ─── Constants ─────────────────────────────────────────────────────────

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// ─── Types ─────────────────────────────────────────────────────────────

export interface CollabMember {
  peerId: string;
  displayName: string;
  color: string;
  isHost: boolean;
  voice?: {
    inVoice: boolean;
    muted: boolean;
    deafened: boolean;
    speaking: boolean;
  };
}

export interface PendingRequest {
  peerId: string;
  displayName: string;
  color: string;
}

export interface SharedFileInfo {
  id: string;
  name: string;
  language: string;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  displayName: string;
  color: string;
  text: string;
  timestamp: number;
}

export type CollabStatus =
  | 'disconnected'
  | 'connecting'
  | 'waiting-approval'
  | 'connected'
  | 'rejected'
  | 'error';

export interface CollabEvents {
  onStatusChange: (status: CollabStatus) => void;
  onMembersUpdate: (members: CollabMember[], pending: PendingRequest[]) => void;
  onJoinRequest: (request: PendingRequest) => void;
  onPeerLeft: (peerId: string, displayName: string) => void;
  onPromotedToHost: () => void;
  onError: (message: string) => void;
  onRoomClosed: () => void;
  onFileShared: (file: SharedFileInfo) => void;
  onFileUnshared: (fileId: string) => void;
  onFilesReordered: (sharedFiles: SharedFileInfo[]) => void;
  onApproved: (sharedFiles: SharedFileInfo[]) => void;
  onChatMessage: (message: ChatMessage) => void;
  onVoiceOffer: (fromPeerId: string, sdp: RTCSessionDescriptionInit) => void;
  onVoiceAnswer: (fromPeerId: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate: (fromPeerId: string, candidate: RTCIceCandidateInit) => void;
}

// ─── Predefined cursor colors ──────────────────────────────────────────

export const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F1948A', '#82E0AA', '#F0B27A', '#AED6F1',
];

export function getRandomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

// ─── WebSocket URL builder ─────────────────────────────────────────────

export function buildWsUrl(path: string): string {
  const rawUrl = (import.meta.env.VITE_COLLAB_URL || '').trim().replace(/\/+$/, '');
  const collabUrl = rawUrl;

  if (collabUrl) {
    // Production: connect directly to the deployed socket server
    // Convert http(s) to ws(s) if needed
    const wsBase = collabUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:');
    return `${wsBase}${path}`;
  }

  // Dev: use Vite proxy at /collab-ws
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/collab-ws${path}`;
}

// ─── DocConnection — per-file Yjs sync ─────────────────────────────────

export class DocConnection {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly fileId: string;
  private ws: WebSocket | null = null;
  private _destroyed = false;
  synced = false;
  private syncListeners = new Set<() => void>();

  onSync(callback: () => void) {
    this.syncListeners.add(callback);
    if (this.synced) callback();
    return () => { this.syncListeners.delete(callback); };
  }

  waitForSync(): Promise<void> {
    if (this.synced) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Shared file did not sync. Rejoin the room.')); }, 12000);
      const unsubscribe = this.onSync(() => { clearTimeout(timeout); unsubscribe(); resolve(); });
    });
  }

  constructor(fileId: string) {
    this.fileId = fileId;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
  }

  connect(roomId: string, displayName: string, color: string, token: string) {
    if (this._destroyed) return;

    // Set user info for cursor rendering
    this.awareness.setLocalStateField('user', {
      name: displayName,
      color: color,
    });

    const wsUrl = buildWsUrl(`/doc/${encodeURIComponent(roomId)}/${encodeURIComponent(this.fileId)}?token=${encodeURIComponent(token)}`);
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // Send our syncStep1 so the server responds with its content (syncStep2)
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this._sendBinary(encoding.toUint8Array(encoder));
    };

    this.ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      this._handleMessage(data);
    };

    this.ws.onclose = () => {};
    this.ws.onerror = () => {};

    // Listen for local doc changes → send to server
    this.doc.on('update', this._onDocUpdate);

    // Listen for local awareness changes → send to server
    this.awareness.on('update', this._onAwarenessUpdate);
  }

  private _handleMessage(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const syncType = syncProtocol.readSyncMessage(
          decoder, encoder, this.doc, this,
        );
        if (syncType === syncProtocol.messageYjsSyncStep2) {
          this.synced = true;
          this.syncListeners.forEach(fn => fn());
        }
        // If there's a response (syncStep2), send it back
        if (encoding.length(encoder) > 1) {
          this._sendBinary(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        applyAwarenessUpdate(this.awareness, update, this);
        break;
      }
    }
  }

  private _onDocUpdate = (update: Uint8Array, origin: any) => {
    if (origin === this) return; // Don't echo server updates

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this._sendBinary(encoding.toUint8Array(encoder));
  };

  private _onAwarenessUpdate = ({ added, updated, removed }: any) => {
    const changedClients = [...added, ...updated, ...removed];
    // Only send if our own client changed
    if (!changedClients.includes(this.doc.clientID)) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, changedClients),
    );
    this._sendBinary(encoding.toUint8Array(encoder));
  };

  private _sendBinary(data: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  destroy() {
    this._destroyed = true;
    this.doc.off('update', this._onDocUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.awareness.destroy();
    this.doc.destroy();
  }
}

// ─── CollabProvider — room-level control ───────────────────────────────

export class CollabProvider {
  readonly roomId: string;
  readonly displayName: string;
  readonly color: string;

  private ws: WebSocket | null = null;
  private events: CollabEvents;
  private _status: CollabStatus = 'disconnected';
  private _isHost = false;
  private _peerId = '';
  private _destroyed = false;
  private _pendingMessages: string[] = [];
  private sessionToken = '';
  workspaceId: string | null = null;
  get workspaceCredentials() { return { roomId: this.roomId, roomToken: this.sessionToken }; }
  agentOwner: string | null = null;
  agentEvents: any[] = [];
  private agentListeners = new Set<(message: any) => void>();
  private requests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  onAgentEvent(listener: (message: any) => void) {
    this.agentListeners.add(listener);
    return () => { this.agentListeners.delete(listener); };
  }

  private requestAgent(type: string, data: Record<string, any> = {}): Promise<any> {
    if (this.status !== 'connected') return Promise.reject(new Error('Reconnect to the collaboration room first.'));
    const requestId = (crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(requestId); reject(new Error('Room request timed out. Rejoin the room.')); }, 12000);
      this.requests.set(requestId, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this._sendJson({ type, requestId, ...data });
    });
  }

  claimAgent() { return this.requestAgent('agent-claim'); }
  releaseAgent() { this._sendJson({ type: 'agent-release' }); }
  publishAgentEvent(event: any) { this._sendJson({ type: 'agent-event', event }); }
  applyAgentEdit(path: string, content: string, previous: string | null, language: string) {
    return this.requestAgent('agent-edit', { path, content, previous, language });
  }

  /** Active per-file doc connections */
  readonly docConnections: Map<string, DocConnection> = new Map();

  constructor(
    roomId: string,
    displayName: string,
    color: string,
    events: CollabEvents,
  ) {
    this.roomId = roomId;
    this.displayName = displayName;
    this.color = color;
    this.events = events;
  }

  get status() { return this._status; }
  get isHost() { return this._isHost; }
  get peerId() { return this._peerId; }

  // ── Control channel ──────────────────────────────────────────────────

  connect() {
    if (this._destroyed) return;
    this._setStatus('connecting');

    const wsUrl = buildWsUrl(`/room/${encodeURIComponent(this.roomId)}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Flush any messages queued before the socket was open
      for (const msg of this._pendingMessages) {
        this.ws!.send(msg);
      }
      this._pendingMessages = [];
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        this._handleJsonMessage(msg);
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.requests.forEach(r => r.reject(new Error('Collaboration disconnected.')));
      this.requests.clear();
      this.agentListeners.forEach(fn => fn({ type: 'agent-disconnected' }));
      if (this._status !== 'rejected' && this._status !== 'error') {
        this._setStatus('disconnected');
      }
    };

    this.ws.onerror = () => {
      this.events.onError('WebSocket connection failed.');
      this._setStatus('error');
    };
  }

  /** Send create-room command (become host) */
  createRoom() {
    this._sendJson({
      type: 'create',
      displayName: this.displayName,
      color: this.color,
    });
  }

  /** Send join-room request */
  joinRoom() {
    this._sendJson({
      type: 'join',
      displayName: this.displayName,
      color: this.color,
    });
  }

  // ── Host actions ─────────────────────────────────────────────────────

  approveJoin(peerId: string) {
    this._sendJson({ type: 'approve', peerId });
  }

  rejectJoin(peerId: string) {
    this._sendJson({ type: 'reject', peerId });
  }

  /** Share a file into the collab room (host only) */
  shareFile(file: { id: string; name: string; language: string; content: string }) {
    this._sendJson({ type: 'share-file', file });
  }

  /** Reorder shared files (host only) */
  reorderFiles(files: SharedFileInfo[]) {
    this._sendJson({ type: 'reorder-files', files });
  }

  /** Remove a file from collab (host only) */
  unshareFile(fileId: string) {
    this._sendJson({ type: 'unshare-file', fileId });
    // Close local doc connection
    const conn = this.docConnections.get(fileId);
    if (conn) {
      conn.destroy();
      this.docConnections.delete(fileId);
    }
  }

  /** Send a chat message to the room */
  sendChatMessage(text: string) {
    this._sendJson({ type: 'chat-message', text });
  }

  /** Join the shared voice lobby for the room */
  joinVoiceLobby() {
    this._sendJson({ type: 'voice-join' });
  }

  /** Leave the shared voice lobby for the room */
  leaveVoiceLobby() {
    this._sendJson({ type: 'voice-leave' });
  }

  /** Update mute/deafen state for this peer */
  setVoiceState(state: { muted: boolean; deafened: boolean }) {
    this._sendJson({
      type: 'voice-state',
      muted: state.muted,
      deafened: state.deafened,
    });
  }

  /** Publish current voice activity (speaking indicator) */
  setSpeaking(speaking: boolean) {
    this._sendJson({ type: 'voice-speaking', speaking });
  }

  /** Send WebRTC offer to a specific peer */
  sendVoiceOffer(targetPeerId: string, sdp: RTCSessionDescriptionInit) {
    this._sendJson({ type: 'voice-offer', targetPeerId, sdp });
  }

  /** Send WebRTC answer to a specific peer */
  sendVoiceAnswer(targetPeerId: string, sdp: RTCSessionDescriptionInit) {
    this._sendJson({ type: 'voice-answer', targetPeerId, sdp });
  }

  /** Send ICE candidate to a specific peer */
  sendIceCandidate(targetPeerId: string, candidate: RTCIceCandidateInit) {
    this._sendJson({ type: 'voice-ice-candidate', targetPeerId, candidate });
  }

  // ── Doc connection management ────────────────────────────────────────

  /** Open a Yjs sync connection for a specific shared file */
  openFileConnection(fileId: string): DocConnection {
    let conn = this.docConnections.get(fileId);
    if (conn) return conn;

    conn = new DocConnection(fileId);
    conn.connect(this.roomId, this.displayName, this.color, this.sessionToken);
    this.docConnections.set(fileId, conn);
    return conn;
  }

  /** Close a specific file's doc connection */
  closeFileConnection(fileId: string) {
    const conn = this.docConnections.get(fileId);
    if (conn) {
      conn.destroy();
      this.docConnections.delete(fileId);
    }
  }

  // ── Disconnect / Destroy ─────────────────────────────────────────────

  disconnect() {
    // Close all doc connections
    for (const [, conn] of this.docConnections) {
      conn.destroy();
    }
    this.docConnections.clear();

    if (this.ws) {
      try { this._sendJson({ type: 'leave' }); } catch {}
      this.ws.close();
      this.ws = null;
    }
    this._setStatus('disconnected');
  }

  destroy() {
    this._destroyed = true;
    this.disconnect();
  }

  // ── Internal message handling ────────────────────────────────────────

  private _handleJsonMessage(msg: any) {
    switch (msg.type) {
      case 'agent-reply': {
        const request = this.requests.get(msg.requestId);
        this.requests.delete(msg.requestId);
        if (msg.error) request?.reject(new Error(msg.error));
        else request?.resolve(msg);
        break;
      }
      case 'agent-owner':
        this.agentOwner = msg.peerId;
        this.agentListeners.forEach(fn => fn(msg));
        break;
      case 'agent-event':
        this.agentEvents = [...this.agentEvents, msg].slice(-150);
        this.agentListeners.forEach(fn => fn(msg));
        break;
      case 'room-created':
        this.sessionToken = msg.sessionToken;
        this._peerId = msg.peerId;
        this._isHost = true;
        this._setStatus('connected');
        break;

      case 'waiting-approval':
        this._peerId = msg.peerId;
        this._setStatus('waiting-approval');
        break;

      case 'room-project':
        this.workspaceId = msg.workspaceId;
        this.agentListeners.forEach(fn => fn(msg));
        break;
      case 'workspace-error':
        this.agentListeners.forEach(fn => fn(msg));
        break;
      case 'approved':
        this.workspaceId = msg.workspaceId || null;
        this.sessionToken = msg.sessionToken;
        this.agentOwner = msg.agentOwner || null;
        this.agentEvents = msg.agentEvents || [];
        this._peerId = msg.peerId;
        this._setStatus('connected');
        this.events.onApproved(msg.sharedFiles || []);
        if (this.workspaceId) this.agentListeners.forEach(fn => fn({ type: 'room-project', workspaceId: this.workspaceId }));
        break;

      case 'rejected':
        this._setStatus('rejected');
        this.events.onError('Your join request was rejected by the host.');
        break;

      case 'room-closed':
        this.events.onRoomClosed();
        this._setStatus('disconnected');
        break;

      case 'members-update':
        this.events.onMembersUpdate(msg.members || [], msg.pending || []);
        break;

      case 'join-request':
        this.events.onJoinRequest({
          peerId: msg.peerId,
          displayName: msg.displayName,
          color: msg.color,
        });
        break;

      case 'peer-left':
        this.events.onPeerLeft(msg.peerId, msg.displayName);
        break;

      case 'promoted-to-host':
        this._isHost = true;
        this.events.onPromotedToHost();
        break;

      case 'file-shared':
        this.events.onFileShared(msg.file);
        break;

      case 'file-unshared':
        // Close doc connection for this file
        this.closeFileConnection(msg.fileId);
        this.events.onFileUnshared(msg.fileId);
        break;
      
      case 'files-reordered':
        this.events.onFilesReordered(msg.sharedFiles || []);
        break;

      case 'chat-message':
        this.events.onChatMessage({
          id: msg.id,
          peerId: msg.peerId,
          displayName: msg.displayName,
          color: msg.color,
          text: msg.text,
          timestamp: msg.timestamp,
        });
        break;

      case 'voice-offer':
        this.events.onVoiceOffer(msg.fromPeerId, msg.sdp);
        break;

      case 'voice-answer':
        this.events.onVoiceAnswer(msg.fromPeerId, msg.sdp);
        break;

      case 'voice-ice-candidate':
        this.events.onIceCandidate(msg.fromPeerId, msg.candidate);
        break;

      case 'error':
        this.events.onError(msg.message || 'Unknown error');
        this._setStatus('error');
        break;
    }
  }

  private _sendJson(msg: any) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Queue messages until the socket opens
      this._pendingMessages.push(data);
    }
  }

  private _setStatus(status: CollabStatus) {
    this._status = status;
    this.events.onStatusChange(status);
  }
}
