import { CollabProvider } from './collabService';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private peers: Map<string, RTCPeerConnection> = new Map();
  private remoteAudios: Map<string, HTMLAudioElement> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private provider: CollabProvider | null = null;
  private _deafened = false;

  setProvider(provider: CollabProvider | null) {
    this.provider = provider;
  }

  setLocalStream(stream: MediaStream) {
    this.localStream = stream;
    for (const [, pc] of this.peers) {
      const senders = pc.getSenders();
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const existing = senders.find((s) => s.track?.kind === 'audio');
        if (existing) {
          existing.replaceTrack(audioTrack);
        } else {
          pc.addTrack(audioTrack, stream);
        }
      }
    }
  }

  connectToPeer(remotePeerId: string) {
    if (this.peers.has(remotePeerId)) return;

    const pc = this._createPeerConnection(remotePeerId);
    this.peers.set(remotePeerId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // Deterministic offerer selection to avoid offer glare:
    // only one side initiates offer based on peerId ordering.
    const selfPeerId = this.provider?.peerId || '';
    const shouldInitiateOffer = Boolean(selfPeerId) && selfPeerId > remotePeerId;
    if (!shouldInitiateOffer) return;

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        if (pc.localDescription) {
          this.provider?.sendVoiceOffer(remotePeerId, pc.localDescription);
        }
      })
      .catch(() => {});
  }

  async handleOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    let pc = this.peers.get(fromPeerId);
    if (!pc) {
      pc = this._createPeerConnection(fromPeerId);
      this.peers.set(fromPeerId, pc);

      if (this.localStream) {
        for (const track of this.localStream.getAudioTracks()) {
          pc.addTrack(track, this.localStream);
        }
      }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this._flushPendingCandidates(fromPeerId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (pc.localDescription) {
      this.provider?.sendVoiceAnswer(fromPeerId, pc.localDescription);
    }
  }

  async handleAnswer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.peers.get(fromPeerId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this._flushPendingCandidates(fromPeerId, pc);
  }

  async handleIceCandidate(fromPeerId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peers.get(fromPeerId);
    if (!pc || !pc.remoteDescription) {
      const queue = this.pendingCandidates.get(fromPeerId) || [];
      queue.push(candidate);
      this.pendingCandidates.set(fromPeerId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      const queue = this.pendingCandidates.get(fromPeerId) || [];
      queue.push(candidate);
      this.pendingCandidates.set(fromPeerId, queue);
    }
  }

  removePeer(peerId: string) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
    this.pendingCandidates.delete(peerId);

    const audio = this.remoteAudios.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.remoteAudios.delete(peerId);
    }
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  setDeafened(deafened: boolean) {
    this._deafened = deafened;
    for (const [, audio] of this.remoteAudios) {
      audio.muted = deafened;
    }
  }

  destroy() {
    for (const [id] of this.peers) {
      this.removePeer(id);
    }
    this.peers.clear();
    this.remoteAudios.clear();
    this.pendingCandidates.clear();
    this.localStream = null;
    this.provider = null;
  }

  private async _flushPendingCandidates(peerId: string, pc: RTCPeerConnection) {
    const queue = this.pendingCandidates.get(peerId);
    if (!queue || queue.length === 0 || !pc.remoteDescription) return;

    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore invalid/stale candidates and continue.
      }
    }
    this.pendingCandidates.delete(peerId);
  }

  private _createPeerConnection(remotePeerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.provider?.sendIceCandidate(remotePeerId, e.candidate.toJSON());
      }
    };

    pc.ontrack = (e) => {
      let audio = this.remoteAudios.get(remotePeerId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.id = `voice-audio-${remotePeerId}`;
        document.body.appendChild(audio);
        this.remoteAudios.set(remotePeerId, audio);
      }
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      audio.muted = this._deafened;
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.removePeer(remotePeerId);
      }
    };

    return pc;
  }
}
