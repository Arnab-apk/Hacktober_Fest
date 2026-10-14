import { ArrowUpRight, Code2, Command, FileCode, Github, Plus, Search } from 'lucide-react';
import type { StoredFile } from '../services/storageService';

export function WorkspaceWelcome({ onNewFile, onImport, onQuickOpen, onCommands, files, onSelect }: {
  onNewFile: () => void; onImport: () => void; onQuickOpen: () => void; onCommands: () => void;
  files: StoredFile[]; onSelect: (id: string) => void;
}) {
  const recent = [...files].sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)).slice(0, 3);
  const actions = [
    { label: 'Create a file', detail: 'A fresh start for your next idea', icon: Plus, shortcut: 'Ctrl N', run: onNewFile },
    { label: 'Import repository', detail: 'Bring your code into the workspace', icon: Github, shortcut: null, run: onImport },
    { label: 'Find a file', detail: 'Jump straight to what matters', icon: Search, shortcut: 'Ctrl P', run: onQuickOpen },
    { label: 'Open commands', detail: 'Every workspace action, one place', icon: Command, shortcut: 'Ctrl Shift P', run: onCommands },
  ];
  return <section className="workspace-welcome" aria-label="Welcome to your workspace">
    <div className="welcome-content">
      <div className="welcome-emblem" aria-hidden="true"><Code2 size={28} strokeWidth={1.6} /></div>
      <p className="welcome-eyebrow">YOUR WORKSPACE, YOUR FLOW</p>
      <h1>Make something great.</h1>
      <p className="welcome-description">A little less friction. A little more focus.<br />Everything you need to build, together.</p>
      <div className="welcome-cards">{actions.map(({ label, detail, icon: Icon, shortcut, run }, index) =>
        <button key={label} onClick={run} className="welcome-card" style={{ animationDelay: index * 45 + 'ms' }}>
          <span className="welcome-card-icon"><Icon size={18} aria-hidden="true" /></span>
          <span className="welcome-card-copy"><strong>{label}</strong><small>{detail}</small></span>
          {shortcut ? <kbd>{shortcut}</kbd> : <ArrowUpRight size={15} className="welcome-card-arrow" aria-hidden="true" />}
        </button>)}</div>
      {!!recent.length && <div className="welcome-recent"><p>RECENT FILES</p>{recent.map(file =>
        <button key={file.id} onClick={() => onSelect(file.id)}><FileCode size={14} aria-hidden="true" /><span>{file.path || file.name}</span><ArrowUpRight size={13} aria-hidden="true" /></button>)}</div>}
      <div className="welcome-footer"><span className="welcome-ready"><span className="welcome-dot" aria-hidden="true" />Ready when you are</span><span className="welcome-footer-divider" /><span className="welcome-hint">Press <kbd>Ctrl Shift P</kbd> to explore</span></div>
    </div>
  </section>;
}
