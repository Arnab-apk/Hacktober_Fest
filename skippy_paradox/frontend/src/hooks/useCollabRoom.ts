/**
 * useCollabRoom — React hook managing the collaborative editing session.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CollabProvider, CollabMember, PendingRequest, CollabStatus,
  SharedFileInfo, CollabEvents, getRandomColor, ChatMessage,
} from '../services/collabService';
import { VoiceManager } from '../services/voiceManager';
import { soundEffects } from '../utils/soundEffects';

export type CollabToast = {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  /** Optional file name to display prominently */
  fileName?: string;
  /** Destination badge shown on the toast */
  destination?: 'collab' | 'myfiles';
  exiting?: boolean;
};

export interface CollabState {
  status: CollabStatus;
  roomId: string | null;
  isHost: boolean;
  displayName: string;
  color: string;
  members: CollabMember[];
  pending: PendingRequest[];
  sharedFiles: SharedFileInfo[];
  provider: CollabProvider | null;
  toasts: CollabToast[];
  chatMessages: ChatMessage[];
  peerId: string;
}

export function useCollabRoom() {
  const [state, setState] = useState<CollabState>({
    status: 'disconnected',
    roomId: null,
    isHost: false,
    displayName: '',
    color: getRandomColor(),
    members: [],
    pending: [],
    sharedFiles: [],
    provider: null,
    toasts: [],
    chatMessages: [],
    peerId: '',
  });

  const [joinError, setJoinError] = useState<string | null>(null);

  const providerRef = useRef<CollabProvider | null>(null);
  const voiceManagerRef = useRef<VoiceManager>(new VoiceManager());

  // ── Cooldown tracking ────────────────────────────────────────────────
  // Maps a dedup key → timestamp of last shown toast
  const cooldownRef = useRef<Map<string, number>>(new Map());
  // Pending debounce timers for spam batching (key → timer id)
  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const COOLDOWN_MS = 2000;  // same message won't re-fire within 2 s
  const DEBOUNCE_MS = 600;   // rapid-fire events are batched within 600 ms

  // ── Toast helpers ────────────────────────────────────────────────────

  const dismissToast = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      toasts: prev.toasts.map(t => t.id === id ? { ...t, exiting: true } : t),
    }));
    setTimeout(() => {
      setState(prev => ({
        ...prev,
        toasts: prev.toasts.filter(t => t.id !== id),
      }));
    }, 300);
  }, []);

  const addToast = useCallback((
    message: string,
    type: CollabToast['type'] = 'info',
    opts?: { fileName?: string; destination?: CollabToast['destination']; dedupKey?: string }
  ) => {
    const dedupKey = opts?.dedupKey ?? message;
    const now = Date.now();
    const last = cooldownRef.current.get(dedupKey) ?? 0;

    // Still within cooldown window — suppress
    if (now - last < COOLDOWN_MS) return;

    cooldownRef.current.set(dedupKey, now);

    const id = now.toString() + Math.random().toString(36).substring(2);
    setState(prev => ({
      ...prev,
      toasts: [
        ...prev.toasts.slice(-4),
        { id, message, type, fileName: opts?.fileName, destination: opts?.destination },
      ],
    }));
    setTimeout(() => dismissToast(id), 4000);
  }, [dismissToast]);

  /**
   * Debounced toast — rapid calls within DEBOUNCE_MS are collapsed into one.
   * The last call wins (most recent file name shown).
   */
  const addToastDebounced = useCallback((
    message: string,
    type: CollabToast['type'],
    opts?: { fileName?: string; destination?: CollabToast['destination']; dedupKey?: string }
  ) => {
    const dedupKey = opts?.dedupKey ?? message;

    // Clear any pending debounce for this key
    const existing = debounceRef.current.get(dedupKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      debounceRef.current.delete(dedupKey);
      addToast(message, type, opts);
    }, DEBOUNCE_MS);

    debounceRef.current.set(dedupKey, timer);
  }, [addToast]);

  // ── Stable event handlers (use providerRef so they never go stale) ──

  const events: CollabEvents = {
    onStatusChange: (status: CollabStatus) => {
      const prov = providerRef.current;
      setState(prev => ({
        ...prev,
        status,
        isHost: prov?.isHost ?? prev.isHost,
        peerId: prov?.peerId ?? prev.peerId,
      }));
    },
    onMembersUpdate: (members: CollabMember[], pending: PendingRequest[]) => {
      setState(prev => {
        // Detect new members (user joined)
        const newMembers = members.filter(m => !prev.members.some(pm => pm.peerId === m.peerId));
        if (newMembers.length > 0) {
          soundEffects.userJoined();
        }
        return { ...prev, members, pending };
      });
    },
    onJoinRequest: (req: PendingRequest) => {
      addToast(`${req.displayName} wants to join`, 'info', { dedupKey: `join-${req.displayName}` });
      soundEffects.notification();
    },
    onPeerLeft: (_pid: string, name: string) => {
      addToast(`${name} left the room`, 'warning', { dedupKey: `left-${name}` });
      soundEffects.userLeft();
    },
    onPromotedToHost: () => {
      setState(prev => ({ ...prev, isHost: true }));
      addToast('You are now the host', 'success', { dedupKey: 'promoted-host' });
    },
    onError: (msg: string) => {
      const prov = providerRef.current;
      const isRoomNotFound = msg.toLowerCase().includes('does not exist');

      if (prov && !prov.isHost && isRoomNotFound) {
        setJoinError(msg);
        prov.destroy();
        providerRef.current = null;
        setState(prev => ({
          ...prev,
          status: 'disconnected',
          roomId: null,
          isHost: false,
          members: [],
          pending: [],
          sharedFiles: [],
          provider: null,
        }));
        return;
      }

      addToast(msg, 'error', { dedupKey: `error-${msg}` });
      if (prov && !prov.isHost) {
        prov.destroy();
        providerRef.current = null;
        setState(prev => ({
          ...prev,
          status: 'disconnected',
          roomId: null,
          isHost: false,
          members: [],
          pending: [],
          sharedFiles: [],
          provider: null,
        }));
      }
    },
    onRoomClosed: () => {
      addToast('Room was closed by the host', 'error', { dedupKey: 'room-closed' });
      providerRef.current = null;
      setState(prev => ({
        ...prev,
        status: 'disconnected',
        roomId: null,
        isHost: false,
        members: [],
        pending: [],
        sharedFiles: [],
        provider: null,
      }));
    },
    onFileShared: (file: SharedFileInfo) => {
      setState(prev => {
        if (prev.sharedFiles.some(f => f.id === file.id)) return prev;
        return { ...prev, sharedFiles: [...prev.sharedFiles, file] };
      });
      addToastDebounced('Added to Collab', 'info', {
        fileName: file.name,
        destination: 'collab',
        dedupKey: `share-${file.id}`,
      });
    },
    onFileUnshared: (fileId: string) => {
      // Grab the file name before removing it from state
      setState(prev => {
        const file = prev.sharedFiles.find(f => f.id === fileId);
        addToastDebounced('Moved to My Files', 'warning', {
          fileName: file?.name,
          destination: 'myfiles',
          dedupKey: `unshare-${fileId}`,
        });
        return { ...prev, sharedFiles: prev.sharedFiles.filter(f => f.id !== fileId) };
      });
    },
    onFilesReordered: (sharedFiles: SharedFileInfo[]) => {
      setState(prev => ({ ...prev, sharedFiles }));
    },
    onApproved: (sharedFiles: SharedFileInfo[]) => {
      setState(prev => ({ ...prev, sharedFiles }));
      addToast('You joined the room!', 'success', { dedupKey: 'approved' });
    },
    onChatMessage: (message: ChatMessage) => {
      setState(prev => {
        // Only play sound for messages from others
        if (message.peerId !== prev.peerId) {
          soundEffects.messageReceived();
        }
        return {
          ...prev,
          chatMessages: [...prev.chatMessages, message],
        };
      });
    },
    onVoiceOffer: (fromPeerId: string, sdp: RTCSessionDescriptionInit) => {
      voiceManagerRef.current.handleOffer(fromPeerId, sdp);
    },
    onVoiceAnswer: (fromPeerId: string, sdp: RTCSessionDescriptionInit) => {
      voiceManagerRef.current.handleAnswer(fromPeerId, sdp);
    },
    onIceCandidate: (fromPeerId: string, candidate: RTCIceCandidateInit) => {
      voiceManagerRef.current.handleIceCandidate(fromPeerId, candidate);
    },
  };

  // ── Create room (user becomes host) ──────────────────────────────────

  const createRoom = useCallback((displayName: string, roomId: string) => {
    providerRef.current?.destroy();

    const color = getRandomColor();
    const provider = new CollabProvider(roomId, displayName, color, events);
    providerRef.current = provider;

    setState(prev => ({
      ...prev,
      roomId,
      displayName,
      color,
      provider,
      isHost: true,
      status: 'connecting',
      members: [],
      pending: [],
      sharedFiles: [],
      chatMessages: [],
      peerId: '',
    }));

    provider.connect();
    provider.createRoom();
    voiceManagerRef.current.setProvider(provider);
  }, []);

  // ── Join room ────────────────────────────────────────────────────────

  const joinRoom = useCallback((displayName: string, roomId: string) => {
    providerRef.current?.destroy();
    setJoinError(null);

    const color = getRandomColor();
    const provider = new CollabProvider(roomId, displayName, color, events);
    providerRef.current = provider;

    setState(prev => ({
      ...prev,
      roomId,
      displayName,
      color,
      provider,
      isHost: false,
      status: 'connecting',
      members: [],
      pending: [],
      sharedFiles: [],
      chatMessages: [],
      peerId: '',
    }));

    provider.connect();
    provider.joinRoom();
    voiceManagerRef.current.setProvider(provider);
  }, []);

  // ── Leave room ───────────────────────────────────────────────────────

  const leaveRoom = useCallback(() => {
    voiceManagerRef.current.destroy();
    voiceManagerRef.current = new VoiceManager();
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    setState(prev => ({
      ...prev,
      status: 'disconnected',
      roomId: null,
      isHost: false,
      members: [],
      pending: [],
      sharedFiles: [],
      provider: null,
      chatMessages: [],
      peerId: '',
    }));
  }, []);

  // ── Host actions ─────────────────────────────────────────────────────

  const approveJoin = useCallback((peerId: string) => {
    providerRef.current?.approveJoin(peerId);
  }, []);

  const rejectJoin = useCallback((peerId: string) => {
    providerRef.current?.rejectJoin(peerId);
  }, []);

  const shareFile = useCallback((file: { id: string; name: string; language: string; content: string }) => {
    providerRef.current?.shareFile(file);
  }, []);

  const unshareFile = useCallback((fileId: string) => {
    providerRef.current?.unshareFile(fileId);
  }, []);

  const reorderFiles = useCallback((files: SharedFileInfo[]) => {
    providerRef.current?.reorderFiles(files);
  }, []);

  const sendChatMessage = useCallback((text: string) => {
    providerRef.current?.sendChatMessage(text);
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────

  useEffect(() => {
    return () => {
      voiceManagerRef.current.destroy();
      providerRef.current?.destroy();
      debounceRef.current.forEach(t => clearTimeout(t));
    };
  }, []);

  return {
    ...state,
    joinError,
    clearJoinError: useCallback(() => setJoinError(null), []),
    createRoom,
    joinRoom,
    leaveRoom,
    approveJoin,
    rejectJoin,
    shareFile,
    unshareFile,
    reorderFiles,
    dismissToast,
    sendChatMessage,
    voiceManager: voiceManagerRef.current,
  };
}
