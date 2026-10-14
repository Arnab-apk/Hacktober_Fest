import { useEffect, useId, useState } from 'react';
import { setServerAccessToken, useServerAccessToken } from '../services/serverAccess';

export function ServerAccessSettings({ disabled = false, className = '' }: { disabled?: boolean; className?: string }) {
  const token = useServerAccessToken();
  const [draft, setDraft] = useState(token);
  const id = useId();
  useEffect(() => setDraft(token), [token]);
  return <div className="space-y-2">
    <label htmlFor={id}>Server access token</label>
    <input id={id} type="password" autoComplete="off" className={className} value={draft} disabled={disabled}
      placeholder="Paste the deployment access token" onChange={e => setDraft(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setServerAccessToken(draft); } }} />
    <button type="button" disabled={disabled || draft.trim() === token} onClick={() => setServerAccessToken(draft)}>Connect</button>
    <p className="text-xs">Use the deployment's SKIPPY_ACCESS_TOKEN from Render Environment settings. This is shared by Agent, Mentor, and workspaces in this tab. Your model API key stays on the server.</p>
  </div>;
}
