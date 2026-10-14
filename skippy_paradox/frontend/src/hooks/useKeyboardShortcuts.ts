/**
 * useKeyboardShortcuts — Professional keyboard navigation system.
 * Implements industry-standard shortcuts for power users.
 */

import { useEffect, useCallback } from 'react';

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[], enabled: boolean = true) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented) return;

      for (const shortcut of shortcuts) {
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = shortcut.alt ? event.altKey : !event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          event.stopPropagation();
          shortcut.action();
          break;
        }
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  return shortcuts;
}

// Common shortcuts preset
export const commonShortcuts = {
  save: { key: 's', ctrl: true, description: 'Save file' },
  newFile: { key: 'n', ctrl: true, description: 'New file' },
  closeFile: { key: 'w', ctrl: true, description: 'Close file' },
  search: { key: 'f', ctrl: true, description: 'Search' },
  commandPalette: { key: 'p', ctrl: true, shift: true, description: 'Command palette' },
  toggleSidebar: { key: 'b', ctrl: true, description: 'Toggle sidebar' },
  toggleTheme: { key: 'd', ctrl: true, shift: true, description: 'Toggle theme' },
};
