import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react';

export interface PaletteCommand {
  id: string;
  label: string;
  detail?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
  shortcut?: string;
}
interface Props {
  isOpen: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  title?: string;
  placeholder?: string;
}
function matchScore(command: PaletteCommand, query: string) {
  const text = [command.label, command.detail, ...(command.keywords || [])].join(' ').toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const direct = text.indexOf(needle);
  if (direct >= 0) return direct;
  let position = 0;
  for (const letter of needle) {
    const next = text.indexOf(letter, position);
    if (next < 0) return Infinity;
    position = next + 1;
  }
  return text.length + position;
}
export const CommandPalette: React.FC<Props> = ({
  isOpen, onClose, commands, title = 'Command palette', placeholder = 'Type a command…',
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const filtered = useMemo(() => commands.map(command => ({ command, score: matchScore(command, query) }))
    .filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score).map(item => item.command), [commands, query]);
  const index = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => { if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus(); };
  }, [isOpen]);
  useEffect(() => { if (isOpen) { setQuery(''); setSelectedIndex(0); inputRef.current?.focus(); } }, [isOpen, title]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);
  if (!isOpen) return null;
  const activate = (command: PaletteCommand) => { onClose(); command.action(); };
  return <div className="ide-picker-layer" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ide-picker" role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setSelectedIndex(current => Math.max(0, Math.min(filtered.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
        }
        if (event.key === 'Enter') { event.preventDefault(); if (filtered[index]) activate(filtered[index]); }
        if (event.key === 'Tab') { event.preventDefault(); inputRef.current?.focus(); }
      }}>
      <div className="ide-picker-input"><Search size={17} aria-hidden="true" />
        <input ref={inputRef} role="combobox" aria-label={title} aria-expanded="true" aria-controls="ide-picker-results"
          aria-autocomplete="list" aria-activedescendant={filtered[index] ? 'ide-option-' + index : undefined}
          value={query} onChange={event => { setQuery(event.target.value); setSelectedIndex(0); }} placeholder={placeholder} />
        <kbd>Esc</kbd>
      </div>
      <div className="ide-picker-label">{title}<span>{filtered.length} results</span></div>
      <div id="ide-picker-results" role="listbox" aria-label={title} className="ide-picker-results custom-scrollbar" ref={listRef}>
        {filtered.length === 0 ? <div className="ide-picker-empty" role="status">No results for “{query}”</div> :
          filtered.map((command, itemIndex) => <div role="option" id={'ide-option-' + itemIndex} aria-selected={itemIndex === index}
            key={command.id} className={'ide-picker-option ' + (itemIndex === index ? 'is-selected' : '')}
            onMouseEnter={() => setSelectedIndex(itemIndex)} onMouseDown={event => event.preventDefault()}
            onClick={() => activate(command)}>
            <span className="ide-picker-icon" aria-hidden="true">{command.icon}</span>
            <span className="ide-picker-text"><span>{command.label}</span>{command.detail && <small>{command.detail}</small>}</span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </div>)}
      </div>
      <div className="ide-picker-footer"><span><ArrowUp size={11} /><ArrowDown size={11} /> Navigate</span><span><CornerDownLeft size={12} /> Open</span><span>Esc to dismiss</span></div>
    </section>
  </div>;
};
