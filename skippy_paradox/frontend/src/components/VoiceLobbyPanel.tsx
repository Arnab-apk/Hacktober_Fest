import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, Signal, X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { CollabMember, CollabProvider } from '../services/collabService';
import { VoiceManager } from '../services/voiceManager';

interface VoiceLobbyPanelProps {
  isOpen: boolean;
  members: CollabMember[];
  selfPeerId: string;
  provider: CollabProvider | null;
  canUseVoice: boolean;
  onClose?: () => void;
  voiceManager: VoiceManager;
}

const VoiceLobbyPanel: React.FC<VoiceLobbyPanelProps> = ({
  isOpen,
  members,
  selfPeerId,
  provider,
  canUseVoice,
  onClose,
  voiceManager,
}) => {
  const { isDark } = useTheme();

  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localInVoice, setLocalInVoice] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);
  const [localDeafened, setLocalDeafened] = useState(false);
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const speakingRef = useRef(false);
  const inVoiceRef = useRef(false);
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selfMember = useMemo(
    () => members.find((m) => m.peerId === selfPeerId) || null,
    [members, selfPeerId],
  );

  const voiceMembers = useMemo(
    () => members.filter((m) => Boolean(m.voice?.inVoice)),
    [members],
  );

  // Keep voice manager bound to the current room provider, even after local resets.
  useEffect(() => {
    voiceManager.setProvider(provider);
  }, [provider, voiceManager]);

  // Block wheel scroll propagation
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.stopPropagation();
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atTop = scrollTop === 0 && e.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [isOpen]);

  const stopAudioMonitoring = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    speakingRef.current = false;
    provider?.setSpeaking(false);
  }, [provider]);

  const startAudioMonitoring = useCallback((stream: MediaStream) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);

      const shouldSpeak = inVoiceRef.current && !mutedRef.current && !deafenedRef.current && rms > 0.035;
      if (shouldSpeak !== speakingRef.current) {
        speakingRef.current = shouldSpeak;
        provider?.setSpeaking(shouldSpeak);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [provider]);

  const handleJoinVoice = useCallback(async () => {
    if (!provider || !canUseVoice || isJoining) return;

    setError(null);
    setIsJoining(true);

    try {
      voiceManager.setProvider(provider);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      voiceManager.setLocalStream(stream);

      provider.joinVoiceLobby();
      provider.setVoiceState({ muted: false, deafened: false });

      setLocalInVoice(true);
      setLocalMuted(false);
      setLocalDeafened(false);
      inVoiceRef.current = true;
      mutedRef.current = false;
      deafenedRef.current = false;

      startAudioMonitoring(stream);

      // Connect to all existing voice members
      for (const m of members) {
        if (m.peerId !== selfPeerId && m.voice?.inVoice) {
          voiceManager.connectToPeer(m.peerId);
        }
      }
    } catch {
      setError('Microphone access denied or unavailable.');
    } finally {
      setIsJoining(false);
    }
  }, [provider, canUseVoice, isJoining, startAudioMonitoring, voiceManager, members, selfPeerId]);

  const handleLeaveVoice = useCallback(() => {
    provider?.setSpeaking(false);
    provider?.leaveVoiceLobby();

    setLocalInVoice(false);
    setLocalMuted(false);
    setLocalDeafened(false);
    inVoiceRef.current = false;
    mutedRef.current = false;
    deafenedRef.current = false;

    stopAudioMonitoring();
    voiceManager.destroy();
    voiceManager.setProvider(provider);
  }, [provider, stopAudioMonitoring, voiceManager]);

  const handleToggleMute = useCallback(() => {
    if (!provider || !localInVoice) return;
    const nextMuted = !localMuted;

    setLocalMuted(nextMuted);
    mutedRef.current = nextMuted;

    if (nextMuted) {
      provider.setSpeaking(false);
      speakingRef.current = false;
    }

    voiceManager.setMuted(nextMuted);
    provider.setVoiceState({ muted: nextMuted, deafened: localDeafened });
  }, [provider, localInVoice, localMuted, localDeafened, voiceManager]);

  const handleToggleDeafen = useCallback(() => {
    if (!provider || !localInVoice) return;
    const nextDeafened = !localDeafened;

    setLocalDeafened(nextDeafened);
    deafenedRef.current = nextDeafened;

    if (nextDeafened) {
      provider.setSpeaking(false);
      speakingRef.current = false;
    }

    voiceManager.setDeafened(nextDeafened);
    provider.setVoiceState({ muted: localMuted, deafened: nextDeafened });
  }, [provider, localInVoice, localMuted, localDeafened, voiceManager]);

  const handleVolumeChange = useCallback((peerId: string, value: number) => {
    setVolumes(prev => ({ ...prev, [peerId]: value }));
    // Adjust the HTMLAudioElement volume for this peer
    const audioEl = document.getElementById(`voice-audio-${peerId}`) as HTMLAudioElement | null;
    if (audioEl) audioEl.volume = value;
  }, []);

  // Connect to new voice members as they join
  useEffect(() => {
    if (!localInVoice) return;
    for (const m of voiceMembers) {
      if (m.peerId !== selfPeerId) {
        voiceManager.connectToPeer(m.peerId);
      }
    }
  }, [voiceMembers, localInVoice, selfPeerId, voiceManager]);

  // Clean up peers that left voice
  useEffect(() => {
    if (!localInVoice) return;
    const voicePeerIds = new Set(voiceMembers.map(m => m.peerId));
    for (const m of members) {
      if (m.peerId !== selfPeerId && !voicePeerIds.has(m.peerId)) {
        voiceManager.removePeer(m.peerId);
      }
    }
  }, [voiceMembers, members, localInVoice, selfPeerId, voiceManager]);

  // Sync state from server
  useEffect(() => {
    const voice = selfMember?.voice;
    if (!voice) return;

    setLocalInVoice(Boolean(voice.inVoice));
    setLocalMuted(Boolean(voice.muted));
    setLocalDeafened(Boolean(voice.deafened));

    inVoiceRef.current = Boolean(voice.inVoice);
    mutedRef.current = Boolean(voice.muted);
    deafenedRef.current = Boolean(voice.deafened);

    if (!voice.inVoice && streamRef.current) {
      stopAudioMonitoring();
    }
  }, [selfMember, stopAudioMonitoring]);

  useEffect(() => {
    return () => stopAudioMonitoring();
  }, [stopAudioMonitoring]);

  if (!isOpen) return null;

  const panelBg = isDark ? 'bg-[var(--ide-bg)]' : 'bg-[var(--ide-bg)]';
  const borderColor = isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]';
  const textPrimary = isDark ? 'text-white' : 'text-[var(--ide-text)]';
  const textMuted_ = isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]';
  const cardBg = isDark ? 'bg-[var(--ide-bg)]' : 'bg-white/80';
  const cardBorder = isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]';

  return (
    <div className={`ide-secondary-panel flex flex-col min-h-0 h-full w-full ${panelBg}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor} shrink-0`}>
        <div className="flex items-center gap-2">
          <Signal size={15} className="text-emerald-400" />
          <h2 className={`text-xs font-medium uppercase tracking-wider ${textMuted_}`}>Voice</h2>
          {localInVoice && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Connected
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className={`p-1.5 rounded ${textMuted_} hover:text-red-400 hover:bg-red-500/10 transition-colors`}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Members list */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide p-3 space-y-1">
        {!localInVoice && voiceMembers.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-10 ${textMuted_} text-center`}>
            <Signal size={32} className="opacity-30 mb-3" />
            <p className="text-[12px] font-medium">No one is in voice</p>
            <p className="text-[11px] opacity-70 mt-1">Join to start talking</p>
          </div>
        )}

        {voiceMembers.map((member) => {
          const voice = member.voice || { inVoice: false, muted: false, deafened: false, speaking: false };
          const isSelf = member.peerId === selfPeerId;
          const isSpeaking = voice.speaking;
          const vol = volumes[member.peerId] ?? 1;

          return (
            <div
              key={member.peerId}
              className={`rounded border p-2.5 transition-all duration-200 ${cardBg} ${cardBorder} ${
                isSpeaking ? 'ring-2 ring-emerald-400/50 border-emerald-400/30' : ''
              }`}
            >
              <div className="flex items-center gap-2.5">
                {/* Avatar with speaking ring */}
                <div className="relative shrink-0">
                  <div
                    className={`w-8 h-8 rounded-full text-[11px] font-medium text-white flex items-center justify-center transition-shadow duration-200 ${
                      isSpeaking ? 'shadow-[0_0_12px_rgba(52,211,153,0.5)]' : ''
                    }`}
                    style={{ backgroundColor: member.color }}
                  >
                    {member.displayName.charAt(0).toUpperCase()}
                  </div>
                  {isSpeaking && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[var(--ide-border)] animate-pulse" />
                  )}
                </div>

                {/* Name + status */}
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-semibold truncate ${textPrimary}`}>
                    {member.displayName}{isSelf ? ' (You)' : ''}
                  </div>
                  <div className={`text-[10px] ${isSpeaking ? 'text-emerald-400' : textMuted_}`}>
                    {isSpeaking ? 'Speaking' : voice.muted ? 'Muted' : 'Listening'}
                  </div>
                </div>

                {/* Status icons */}
                <div className="flex items-center gap-1">
                  {voice.muted && <MicOff size={12} className="text-red-400/70" />}
                  {voice.deafened && <HeadphoneOff size={12} className="text-amber-400/70" />}
                </div>
              </div>

              {/* Per-user volume slider (only for remote peers when in voice) */}
              {localInVoice && !isSelf && (
                <div className="flex items-center gap-2 mt-2 px-1">
                  <Headphones size={11} className={textMuted_} />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={vol}
                    onChange={(e) => handleVolumeChange(member.peerId, parseFloat(e.target.value))}
                    className="flex-1 h-1 accent-emerald-400 cursor-pointer"
                    style={{ accentColor: '#34d399' }}
                  />
                  <span className={`text-[10px] w-7 text-right ${textMuted_}`}>
                    {Math.round(vol * 100)}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 mt-2">
            <p className="text-[11px] text-red-400">{error}</p>
          </div>
        )}

        {!canUseVoice && !localInVoice && (
          <p className={`text-[10px] mt-2 px-1 ${textMuted_}`}>
            Voice is available after the room is connected.
          </p>
        )}
      </div>

      {/* Bottom control bar */}
      <div className={`shrink-0 border-t ${borderColor} px-4 py-3`}>
        {!localInVoice ? (
          <button
            disabled={!canUseVoice || isJoining}
            onClick={handleJoinVoice}
            className={`w-full py-2 rounded text-[12px] font-semibold transition-all ${
              !canUseVoice || isJoining
                ? 'opacity-40 cursor-not-allowed bg-[var(--ide-panel)] text-[var(--ide-muted)]'
                : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 '
            }`}
          >
            {isJoining ? 'Joining...' : 'Join Voice'}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={handleToggleMute}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-[12px] font-semibold transition-all  ${
                localMuted
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : `${isDark ? 'bg-[var(--ide-bg)] text-[var(--ide-text)]' : 'bg-[var(--ide-panel)] text-[var(--ide-muted)]'} hover:bg-[var(--ide-hover)]`
              }`}
              title={localMuted ? 'Unmute' : 'Mute'}
            >
              {localMuted ? <MicOff size={14} /> : <Mic size={14} />}
              {localMuted ? 'Muted' : 'Mic'}
            </button>

            <button
              onClick={handleToggleDeafen}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-[12px] font-semibold transition-all  ${
                localDeafened
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                  : `${isDark ? 'bg-[var(--ide-bg)] text-[var(--ide-text)]' : 'bg-[var(--ide-panel)] text-[var(--ide-muted)]'} hover:bg-[var(--ide-hover)]`
              }`}
              title={localDeafened ? 'Undeafen' : 'Deafen'}
            >
              {localDeafened ? <HeadphoneOff size={14} /> : <Headphones size={14} />}
              {localDeafened ? 'Deaf' : 'Audio'}
            </button>

            <button
              onClick={handleLeaveVoice}
              className="py-2 px-3 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all "
              title="Disconnect"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceLobbyPanel;
