import { useMemo } from 'react';
import { createTwoFilesPatch } from 'diff';
import { FileDiff } from '../services/workspaceService';

export function CheckpointDiff({diff,isDark}:{diff:FileDiff;isDark:boolean}) {
  const patch=useMemo(()=>createTwoFilesPatch('checkpoint/'+diff.path,'current/'+diff.path,diff.before||'',diff.after||'','','',{context:3,timeout:200,maxEditLength:10000}),[diff.path,diff.before,diff.after]);
  const lines=(patch||'').split('\n');
  const download=()=>{
    const url=URL.createObjectURL(new Blob([patch||''],{type:'text/plain'}));
    const link=document.createElement('a');link.href=url;link.download=diff.path.split('/').join('_')+'.patch';link.click();URL.revokeObjectURL(url);
  };
  if(!patch)return <div className="grid grid-cols-2 gap-2"><div><p className="text-xs">Checkpoint</p><pre className="max-h-80 overflow-auto whitespace-pre text-xs p-2">{diff.before}</pre></div><div><p className="text-xs">Current</p><pre className="max-h-80 overflow-auto whitespace-pre text-xs p-2">{diff.after}</pre></div><p className="col-span-2 text-xs">The change is too large for a line diff. Both versions are shown for comparison.</p></div>;
  return <div aria-label={'Checkpoint diff for '+diff.path} className="border border-slate-500/20 rounded-md overflow-hidden">
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs border-b border-slate-500/20"><span>− Removed from checkpoint · + Added in current files</span><button className="underline focus-visible:outline focus-visible:outline-purple-400" onClick={download}>Download diff</button></div>
    <pre className="max-h-[45dvh] overflow-auto text-xs leading-5 font-mono" tabIndex={0}>{lines.slice(0,1500).map((line,index)=><span key={index} className={`block min-h-5 px-3 ${line.startsWith('+')&&!line.startsWith('+++')?(isDark?'bg-emerald-500/10 text-emerald-300':'bg-emerald-50 text-emerald-900'):line.startsWith('-')&&!line.startsWith('---')?(isDark?'bg-red-500/10 text-red-300':'bg-red-50 text-red-900'):line.startsWith('@@')?'text-purple-400 bg-purple-500/5':''}`}>{line||' '}</span>)}</pre>
    {lines.length>1500&&<p className="p-2 text-xs">Showing the first 1,500 lines. Download the diff to review the entire change.</p>}
  </div>;
}
