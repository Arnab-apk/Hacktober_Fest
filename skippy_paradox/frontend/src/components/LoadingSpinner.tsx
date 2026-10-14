/**
 * LoadingSpinner — Professional loading states with multiple variants.
 * Provides visual feedback during async operations.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'spinner' | 'dots' | 'pulse' | 'skeleton';
  text?: string;
  fullScreen?: boolean;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  variant = 'spinner',
  text,
  fullScreen = false,
}) => {
  const { isDark } = useTheme();

  const sizeMap = {
    sm: 16,
    md: 24,
    lg: 32,
    xl: 48,
  };

  const iconSize = sizeMap[size];

  const renderSpinner = () => {
    switch (variant) {
      case 'spinner':
        return (
          <Loader2 
            size={iconSize} 
            className={`animate-spin ${isDark ? 'text-purple-400' : 'text-purple-600'}`} 
          />
        );

      case 'dots':
        return (
          <div className="flex items-center gap-2">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full ${
                  isDark ? 'bg-purple-400' : 'bg-purple-600'
                }`}
                style={{
                  animation: 'pulse 1.4s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        );

      case 'pulse':
        return (
          <div className="relative">
            <div className={`w-12 h-12 rounded-full ${
              isDark ? 'bg-purple-500/20' : 'bg-purple-200'
            } animate-ping absolute`} />
            <div className={`w-12 h-12 rounded-full ${
              isDark ? 'bg-purple-500/40' : 'bg-purple-300'
            } relative`} />
          </div>
        );

      case 'skeleton':
        return (
          <div className="space-y-3 w-full max-w-sm">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className={`h-4 rounded ${
                  isDark ? 'bg-slate-700' : 'bg-slate-200'
                } animate-pulse`}
                style={{ width: `${100 - i * 15}%` }}
              />
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      {renderSpinner()}
      {text && (
        <p className={`text-sm font-medium ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>
          {text}
        </p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className={`fixed inset-0 z-50 flex items-center justify-center ${
        isDark ? 'bg-[#1E1E2A]' : 'bg-white'
      }`}>
        {content}
      </div>
    );
  }

  return content;
};
