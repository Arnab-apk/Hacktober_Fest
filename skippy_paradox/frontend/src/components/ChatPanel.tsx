import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { ChatMessage } from '../services/collabService';

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessage[];
  selfPeerId: string;
  onSendMessage: (text: string) => void;
  canSend?: boolean;
  onClose?: () => void;
}

const MAX_MESSAGE_LENGTH = 1200;

export const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  messages,
  selfPeerId,
  onSendMessage,
  canSend = true,
  onClose,
}) => {
  const { isDark } = useTheme();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  useEffect(() => {
    if (isOpen && canSend) inputRef.current?.focus();
  }, [isOpen, canSend]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    const value = inputValue.trim();
    if (!value) return;
    onSendMessage(value);
    setInputValue('');
  };

  const remaining = MAX_MESSAGE_LENGTH - inputValue.length;

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const bg = isDark ? 'bg-[var(--ide-bg)]' : 'bg-[var(--ide-bg)]';
  const border = isDark ? 'border-[var(--ide-border)]' : 'border-[var(--ide-border)]';
  const textPrimary = isDark ? 'text-white' : 'text-[var(--ide-text)]';
  const textMuted = isDark ? 'text-[var(--ide-muted)]' : 'text-[var(--ide-muted)]';
  const inputBg = isDark
    ? 'bg-[var(--ide-bg)] border-[var(--ide-border)]'
    : 'bg-white border-[var(--ide-border)]';

  return (
    <div className={`ide-secondary-panel flex flex-col h-full w-full ${bg} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${border} shrink-0`}>
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-[var(--ide-accent)]" />
          <span className={`text-[11px] font-medium uppercase tracking-wider ${textMuted}`}>
            Room Chat
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className={`p-1 rounded ${textMuted} hover:text-red-400 hover:bg-red-500/10 transition-colors`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="h-full overflow-y-auto scrollbar-hide p-3 space-y-2.5"
        >
          {messages.length === 0 && (
            <div className={`flex flex-col items-center justify-center h-full ${textMuted}`}>
              <MessageSquare size={22} className="mb-2 opacity-30" />
              <p className="text-[11px]">No messages yet</p>
              <p className="text-[10px] mt-0.5 opacity-40">Say hello to your collaborators!</p>
            </div>
          )}

          {messages.map((msg) => {
            const isSelf = msg.peerId === selfPeerId;
            return (
              <div key={msg.id} className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-1.5 mb-0.5 mx-1">
                  {!isSelf && (
                    <div
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-medium text-white shrink-0"
                      style={{ backgroundColor: msg.color }}
                    >
                      {msg.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className={`text-[10px] font-medium ${isSelf ? 'text-[var(--ide-accent)]' : textMuted}`}>
                    {isSelf ? 'You' : msg.displayName}
                  </span>
                  <span className={`text-[9px] ${textMuted} opacity-40`}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div
                  className={`px-2.5 py-1.5 rounded text-[12px] max-w-[85%] leading-relaxed ${
                    isSelf
                      ? 'bg-[var(--ide-bg)] text-[var(--ide-accent)] rounded-tr-sm'
                      : isDark
                        ? 'bg-[var(--ide-bg)] text-[var(--ide-text)] rounded-tl-sm'
                        : 'bg-white text-[var(--ide-text)] border border-[var(--ide-border)] rounded-tl-sm'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className={`p-2.5 border-t ${border} shrink-0`}>
        <form onSubmit={handleSend} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            placeholder={canSend ? 'Type a message...' : 'Join a room to chat'}
            disabled={!canSend}
            maxLength={MAX_MESSAGE_LENGTH}
            className={`w-full pl-3 pr-9 py-2 rounded text-[12px] focus:outline-none transition-colors border ${inputBg} ${textPrimary} placeholder:text-[var(--ide-muted)] focus:ring-1 focus:ring-[var(--ide-accent)] focus:border-[var(--ide-border)]`}
          />
          <button
            type="submit"
            disabled={!canSend || !inputValue.trim()}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded transition-colors ${
              !canSend || !inputValue.trim()
                ? 'opacity-20 cursor-not-allowed'
                : 'text-[var(--ide-accent)] hover:bg-[var(--ide-hover)]'
            }`}
          >
            <Send size={13} />
          </button>
        </form>
        <div className={`mt-1 flex items-center justify-between text-[9px] ${textMuted} opacity-60`}>
          <span>{canSend ? 'Enter to send' : ''}</span>
          {remaining < 100 && <span className={remaining < 40 ? 'text-amber-400' : ''}>{remaining}</span>}
        </div>
      </div>
    </div>
  );
};
