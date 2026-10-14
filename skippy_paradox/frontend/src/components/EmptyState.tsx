/**
 * EmptyState — Beautiful empty state component with illustrations.
 * Provides clear guidance and calls-to-action.
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}) => {
  const { isDark } = useTheme();

  return (
    <div className="flex items-center justify-center h-full min-h-[300px] p-8">
      <div className="text-center max-w-md">
        {/* Icon with gradient background */}
        <div className={`relative w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center ${
          isDark 
            ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20' 
            : 'bg-gradient-to-br from-purple-100 to-blue-100'
        }`}>
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 blur-xl" />
          <Icon 
            size={36} 
            className={isDark ? 'text-purple-400 relative z-10' : 'text-purple-600 relative z-10'} 
          />
        </div>

        {/* Title */}
        <h3 className={`text-xl font-bold mb-2 ${
          isDark ? 'text-white' : 'text-slate-900'
        }`}>
          {title}
        </h3>

        {/* Description */}
        <p className={`text-sm mb-6 leading-relaxed ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>
          {description}
        </p>

        {/* Actions */}
        {(action || secondaryAction) && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {action && (
              <button
                onClick={action.onClick}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-all active:scale-95 shadow-lg shadow-purple-500/25"
              >
                {action.icon && <action.icon size={18} />}
                {action.label}
              </button>
            )}
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all active:scale-95 ${
                  isDark
                    ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {secondaryAction.icon && <secondaryAction.icon size={18} />}
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
