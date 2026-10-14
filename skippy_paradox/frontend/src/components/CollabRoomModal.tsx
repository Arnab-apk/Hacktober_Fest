/**
 * CollabRoomModal — UI for creating or joining a collaborative room.
 *
 * Two tabs:
 *   • Create Room: enter display name → generates a room ID → host mode
 *   • Join Room: enter room ID + display name → sends join request
 */

import React, { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useMountTransition } from '../hooks/useMountTransition';
import { X, Users, Plus, LogIn, Copy, Check } from 'lucide-react';
import { ModalSurface } from './ModalSurface';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreateRoom: (displayName: string, roomId: string) => void;
  onJoinRoom: (displayName: string, roomId: string) => void;
  joinError?: string | null;
  onClearJoinError?: () => void;
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const CollabRoomModal: React.FC<Props> = ({ isOpen, onClose, onCreateRoom, onJoinRoom, joinError, onClearJoinError }) => {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('codecollab_displayName') || '');
  const [roomId, setRoomId] = useState('');
  const [generatedId] = useState(generateRoomId);

  useEffect(() => {
    localStorage.setItem('codecollab_displayName', displayName);
  }, [displayName]);
  const [copied, setCopied] = useState(false);

  const { hasRendered, isActive } = useMountTransition(isOpen, 300);

  if (!hasRendered) return null;

  const bg = isDark ? 'bg-[var(--ide-bg)]' : 'bg-white';
  const border = isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]';
  const textP = isDark ? 'text-white' : 'text-[var(--ide-text)]';
  const textM = isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]';
  const inputBg = isDark ? 'bg-[var(--ide-bg)]' : 'bg-[var(--ide-panel)]';
  const inputBorder = isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]';
  const inputText = isDark ? 'text-white' : 'text-[var(--ide-text)]';

  const handleCopyId = () => {
    navigator.clipboard.writeText(generatedId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = () => {
    if (!displayName.trim()) return;
    onCreateRoom(displayName.trim(), generatedId);
    onClose();
  };

  const handleJoin = () => {
    if (!displayName.trim() || !roomId.trim()) return;
    onClearJoinError?.();
    onJoinRoom(displayName.trim(), roomId.trim().toUpperCase());
    // Don't close — wait for approval or show error
  };

  return (
    <div className="ide-modal-layer fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className={`absolute inset-0 bg-black/60  transition-opacity duration-300 ease-out ${isActive ? 'opacity-100' : 'opacity-0'}`} />

      {/* Modal */}
      <ModalSurface title="Live Collaboration" onClose={onClose} className="ide-modal-small">
        <div
          className={`${bg} rounded overflow-hidden relative`}
          onClick={e => e.stopPropagation()}
        >
        
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${border} relative z-10`}>
          <div className="flex items-center gap-2">
            <Users size={20} className="text-[var(--ide-accent)]" />
            <h2 className={`text-lg font-medium ${textP}`}>Live Collaboration</h2>
          </div>
          <button aria-label="Close dialog" onClick={onClose} className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-[var(--ide-hover)]' : 'hover:bg-[var(--ide-hover)]'}`}>
            <X size={18} className={textM} />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${border} relative z-10`}>
          {(['create', 'join'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-all relative ${
                tab === t
                  ? `${textP} after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--ide-bg)]`
                  : `${textM} hover:${textP}`
              }`}
            >
              {t === 'create' ? (
                <span className="flex items-center justify-center gap-1.5"><Plus size={14} /> Host Room</span>
              ) : (
                <span className="flex items-center justify-center gap-1.5"><LogIn size={14} /> Join Room</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 relative z-10">
          {/* Display Name (shared by both tabs) */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textM}`}>DISPLAY NAME</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. John"
              maxLength={30}
              className={`w-full px-3 py-2.5 rounded border ${inputBg} ${inputBorder} ${inputText} text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--ide-accent)] focus:border-[var(--ide-border)] transition-all`}
            />
          </div>

          <div className="grid grid-cols-1">
            {/* Create Room Tab */}
            <div
              className={`col-start-1 row-start-1 flex flex-col space-y-4 transition-all duration-300 ${
                tab === 'create' ? 'opacity-100 z-10' : 'opacity-0 -z-10 invisible'
              }`}
            >
              {/* Generated Room ID */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${textM}`}>ROOM ID</label>
                <div className="flex gap-2">
                  <div className={`flex-1 flex items-center px-4 py-2.5 rounded border ${inputBg} ${inputBorder} font-mono text-lg tracking-[0.3em] ${textP} font-medium select-all`}>
                    {generatedId}
                  </div>
                  <button
                    onClick={handleCopyId}
                    className="flex items-center justify-center px-3 rounded bg-[var(--ide-bg)] hover:bg-[var(--ide-hover)] text-[var(--ide-accent)] border border-[var(--ide-border)] transition-all "
                    title="Copy Room ID"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={!displayName.trim()}
                className="w-full py-3 rounded bg-[var(--ide-bg)] hover:bg-[var(--ide-hover)] text-[var(--ide-accent)] font-medium text-sm transition-all  disabled:opacity-40 disabled:pointer-events-none shadow-none mt-auto"
              >
                Create & Host Room
              </button>
            </div>

            {/* Join Room Tab */}
            <div
              className={`col-start-1 row-start-1 flex flex-col space-y-4 transition-all duration-300 ${
                tab === 'join' ? 'opacity-100 z-10' : 'opacity-0 -z-10 invisible'
              }`}
            >
              {/* Room ID input */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${textM}`}>ROOM ID</label>
                <input
                  type="text"
                  value={roomId}
                  onChange={e => { setRoomId(e.target.value.toUpperCase()); onClearJoinError?.(); }}
                  placeholder="e.g. A3K7M2"
                  maxLength={10}
                  className={`w-full px-4 py-2.5 rounded border ${inputBg} ${
                    joinError ? 'border-red-400 ring-2 ring-red-400/30' : inputBorder
                  } font-mono text-lg tracking-[0.3em] font-medium ${textP} placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--ide-accent)] focus:border-[var(--ide-border)] transition-all uppercase`}
                />
                {joinError && (
                  <p className="text-xs mt-1.5 text-red-400 font-medium">{joinError}</p>
                )}
              </div>

              <button
                onClick={handleJoin}
                disabled={!displayName.trim() || !roomId.trim()}
                className="w-full py-3 rounded bg-[var(--ide-bg)] hover:bg-[var(--ide-hover)] text-[var(--ide-accent)] font-medium text-sm transition-all  disabled:opacity-40 disabled:pointer-events-none shadow-none mt-auto"
              >
                Request to Join
              </button>
            </div>
          </div>
        </div>
        </div>
      </ModalSurface>
    </div>
  );
};
