/**
 * NotificationCenter — Advanced notification system with grouping and actions.
 * Manages all app notifications in one place.
 */

import React, { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { Bell, X, AlertCircle, Info, CheckCircle } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
  read?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationCenterProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onClearAll: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onDismiss,
  onMarkAsRead,
  onClearAll,
}) => {
  const { isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success': return <CheckCircle size={18} className="text-green-400" />;
      case 'error': return <AlertCircle size={18} className="text-red-400" />;
      case 'warning': return <AlertCircle size={18} className="text-amber-400" />;
      default: return <Info size={18} className="text-blue-400" />;
    }
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const bg = isDark ? 'bg-[#1a1a2e]' : 'bg-white';
  const border = isDark ? 'border-slate-700/50' : 'border-slate-200';
  const textP = isDark ? 'text-white' : 'text-slate-900';
  const textM = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="relative">
      {/* Bell Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-lg transition-colors ${
          isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'
        }`}
        aria-label="Notifications"
      >
        <Bell size={20} className={textM} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div
            className={`absolute right-0 top-12 w-96 max-w-[calc(100vw-2rem)] ${bg} rounded-xl shadow-2xl border ${border} z-50 overflow-hidden animate-fade-in-up`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${border}`}>
              <h3 className={`text-sm font-bold ${textP}`}>
                Notifications {unreadCount > 0 && `(${unreadCount})`}
              </h3>
              {notifications.length > 0 && (
                <button
                  onClick={onClearAll}
                  className={`text-xs font-medium ${textM} hover:text-red-400 transition-colors`}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {notifications.length === 0 ? (
                <div className={`flex flex-col items-center justify-center py-12 ${textM}`}>
                  <Bell size={32} className="mb-2 opacity-40" />
                  <p className="text-sm">No notifications</p>
                </div>
              ) : (
                notifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`relative px-4 py-3 border-b ${border} transition-colors ${
                      notif.read
                        ? isDark ? 'bg-transparent' : 'bg-transparent'
                        : isDark ? 'bg-purple-500/5' : 'bg-purple-50/50'
                    } ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}
                    onClick={() => !notif.read && onMarkAsRead(notif.id)}
                  >
                    <div className="flex gap-3">
                      <div className="shrink-0 mt-0.5">
                        {getIcon(notif.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className={`text-sm font-semibold ${textP} truncate`}>
                            {notif.title}
                          </h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDismiss(notif.id);
                            }}
                            className={`shrink-0 p-1 rounded hover:bg-red-500/10 ${textM} hover:text-red-400 transition-colors`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <p className={`text-xs ${textM} mb-2 leading-relaxed`}>
                          {notif.message}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${textM}`}>
                            {formatTime(notif.timestamp)}
                          </span>
                          {notif.action && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                notif.action!.onClick();
                              }}
                              className="text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors"
                            >
                              {notif.action.label}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {!notif.read && (
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-purple-500" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
