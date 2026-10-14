import { useCallback, useEffect, useRef, useState } from 'react';
import { StoredFile, computeContentHash } from '../services/storageService';
import { CollabProvider } from '../services/collabService';
import { hydrateFiles } from '../services/harnessService';
import { detectLanguage } from '../utils/detectLanguage';
import { Checkpoint, DiskFile, Project, ProjectSnapshot, workspaceRequest } from '../services/workspaceService';

const toStored = (f: DiskFile): StoredFile => ({...f, language:detectLanguage(f.path,f.content),contentHash:computeContentHash(f.content),lastModified:Date.now(),contentLoaded:true});
export interface DiskConflict { path: string; disk: DiskFile | null }
export function useWorkspace(files: StoredFile[], setFiles: React.Dispatch<React.SetStateAction<StoredFile[]>>, activeFileId: string | null, setActiveFileId: React.Dispatch<React.SetStateAction<string | null>>, room: CollabProvider | null, initialized: boolean) {
  const [project,setProject] = useState<Project | null>(null);
  const [projects,setProjects] = useState<Project[]>([]);
  const [checkpoints,setCheckpoints] = useState<Checkpoint[]>([]);
  const [conflicts,setConflicts] = useState<DiskConflict[]>([]);
  const [error,setError] = useState('');
  const [status,setStatus] = useState('Browser files');
  const [busy,setBusy] = useState(false);
  const filesRef = useRef(files); filesRef.current = files;
  const activeRef = useRef(activeFileId); activeRef.current = activeFileId;
  const projectRef = useRef(project); projectRef.current = project;
  const roomRef = useRef(room); roomRef.current = room;
  const baseline = useRef(new Map<string,DiskFile>());
  const conflictsRef = useRef<DiskConflict[]>([]);
  const serial = useRef(Promise.resolve());
  const epoch = useRef(0);
  const switching = useRef(false);

  const apply = useCallback((snapshot: ProjectSnapshot) => {
    baseline.current = new Map(snapshot.files.map(f=>[f.path,f]));
    filesRef.current = snapshot.files.map(toStored);
    setFiles(filesRef.current);
    const id = snapshot.project.activeFileId;
    setActiveFileId(id && snapshot.files.some(f=>f.id===id) ? id : snapshot.files[0]?.id || null);
    projectRef.current = snapshot.project; setProject(snapshot.project);
    setCheckpoints(snapshot.checkpoints);
    conflictsRef.current = []; setConflicts([]); setError('');
    setStatus(snapshot.skipped.length ? `Saved · ${snapshot.skipped.length} binary, large, or excluded files` : 'Saved to disk');
    localStorage.setItem('skippy-active-project',snapshot.project.id);
  },[setFiles,setActiveFileId]);

  const refreshProjects = useCallback(async () => {
    const result = await workspaceRequest<{projects:Project[]}>('/projects',roomRef.current);
    setProjects(result.projects);
  },[]);

  const merge = useCallback((snapshot: ProjectSnapshot) => {
    const previous = baseline.current;
    const disk = new Map(snapshot.files.map(f=>[f.path,f]));
    const editor = new Map(filesRef.current.map(f=>[f.path || f.name,f]));
    const merged: StoredFile[] = [];
    const unresolved: DiskConflict[] = [];
    for (const filename of new Set([...previous.keys(),...disk.keys(),...editor.keys()])) {
      const old = previous.get(filename);
      const remote = disk.get(filename);
      const current = editor.get(filename);
      const dirty = current?.content !== old?.content;
      const changed = remote?.content !== old?.content;
      const conflict = conflictsRef.current.some(c=>c.path===filename) || (dirty && changed && current?.content !== remote?.content);
      if (conflict) { unresolved.push({path:filename,disk:remote || null}); if (current) merged.push(current); }
      else if (dirty) { if (current) merged.push(remote ? {...current,id:remote.id} : current); }
      else if (remote) merged.push(current && current.content === remote.content ? {...current,id:remote.id} : toStored(remote));
    }
    baseline.current = disk;
    conflictsRef.current = unresolved; setConflicts(unresolved);
    filesRef.current = merged;
    setFiles(prev => JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged);
    setActiveFileId(prev => merged.some(f=>f.id===prev) ? prev : merged[0]?.id || null);
    projectRef.current = snapshot.project; setProject(snapshot.project); setCheckpoints(snapshot.checkpoints);
    if (unresolved.length) setStatus('Disk conflict · choose which version to keep');
    if (snapshot.syncError) setError(snapshot.syncError);
  },[setFiles,setActiveFileId]);

  const flush = useCallback((): Promise<void> => {
    const ticket = epoch.current;
    const execute = async () => {
      const currentProject = projectRef.current;
      if (!currentProject || switching.current || ticket !== epoch.current) return;
      if (conflictsRef.current.length) throw new Error('Resolve disk conflicts before running commands or saving.');
      const activeRoom = roomRef.current?.status === 'connected' ? roomRef.current : null;
      if (activeRoom) await Promise.all([...activeRoom.docConnections.values()].map(c=>c.waitForSync()));
      const all = await hydrateFiles(filesRef.current);
      const contents = new Map(all.map(f=>[f.path || f.name,f.content]));
      if (contents.size !== all.length) throw new Error('Duplicate file paths. Rename duplicate files before saving the project.');
      const changes = [...new Set([...baseline.current.keys(),...contents.keys()])].filter(p=>baseline.current.get(p)?.content !== contents.get(p)).map(p=>({path:p,content:contents.get(p) ?? null,previous:baseline.current.get(p)?.content ?? null}));
      if (!changes.length && currentProject.activeFileId === activeRef.current) return;
      setStatus('Saving…');
      const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${currentProject.id}/sync`,activeRoom,{changes,activeFileId:activeRef.current,config:currentProject.config});
      if (ticket !== epoch.current) return;
      // Edits made during the request remain dirty against the new disk baseline.
      const sent = new Map(all.map(f=>[f.path || f.name,f.content]));
      baseline.current = new Map(snapshot.files.map(f=>[f.path,f]));
      const remote = new Map(snapshot.files.map(f=>[f.path,f]));
      const hydrated = new Map(all.map(f=>[f.id,f]));
      const latest = filesRef.current.map(f=>{ const loaded = f.contentLoaded === false ? hydrated.get(f.id) || f : f; return remote.has(f.path || f.name) ? {...loaded,id:remote.get(f.path || f.name)!.id} : loaded; });
      for (const f of snapshot.files) if (!latest.some(e=>(e.path || e.name)===f.path) && !sent.has(f.path)) latest.push(toStored(f));
      filesRef.current = latest; setFiles(prev => JSON.stringify(prev) === JSON.stringify(latest) ? prev : latest);
      setActiveFileId(prev => all.find(f=>f.id===prev) ? remote.get(all.find(f=>f.id===prev)!.path || all.find(f=>f.id===prev)!.name)?.id || prev : prev);
      projectRef.current = snapshot.project; setProject(snapshot.project); setCheckpoints(snapshot.checkpoints);
      setStatus('Saved to disk'); setError('');
    };
    const result = serial.current.then(execute);
    serial.current = result.catch(()=>{});
    return result;
  },[setFiles,setActiveFileId]);

  const open = useCallback(async (id: string, save = true) => {
    if (projectRef.current?.agentBusy) throw new Error('Stop Skippy before switching projects.');
    if (save) await flush();
    switching.current = true; const ticket = ++epoch.current; setBusy(true);
    try {
      const activeRoom = roomRef.current?.status === 'connected' ? roomRef.current : null;
      if (activeRoom && activeRoom.workspaceId !== id) await workspaceRequest(`/projects/${id}/bind`,activeRoom,{});
      const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${id}`,activeRoom);
      if (ticket === epoch.current) apply(snapshot);
      await refreshProjects();
    } finally { switching.current = false; setBusy(false); }
  },[flush,apply,refreshProjects]);

  const create = useCallback(async (name: string, initial?: Array<{path:string;content:string}>) => {
    await flush(); setBusy(true);
    try {
      let seed = initial;
      if (!seed) {
        const activeRoom = roomRef.current?.status === 'connected' ? roomRef.current : null;
        if (activeRoom) {
          await Promise.all([...activeRoom.docConnections.values()].map(c=>c.waitForSync()));
          seed = [...activeRoom.docConnections].map(([id,c])=>({path:filesRef.current.find(f=>f.id===id)?.path || filesRef.current.find(f=>f.id===id)?.name || id,content:c.doc.getText('monaco').toString()}));
        } else seed = (await hydrateFiles(filesRef.current)).map(f=>({path:f.path || f.name,content:f.content}));
      }
      const snapshot = await workspaceRequest<ProjectSnapshot>('/projects',roomRef.current,{name,files:seed});
      await open(snapshot.project.id,false);
    } finally {setBusy(false);}
  },[flush,open]);

  const checkpoint = useCallback(async (label: string) => {
    await flush(); const current = projectRef.current; if (!current) throw new Error('Save a project first.');
    await workspaceRequest(`/projects/${current.id}/checkpoints`,roomRef.current,{label});
    const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${current.id}`,roomRef.current);
    setCheckpoints(snapshot.checkpoints);
  },[flush]);

  const restore = useCallback(async (id: string) => {
    await flush(); const current = projectRef.current; if (!current) return;
    const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${current.id}/checkpoints/${id}/restore`,roomRef.current,{});
    ++epoch.current; apply(snapshot);
  },[flush,apply]);

  const removeFile = useCallback(async (id: string) => {
    await flush(); const current = projectRef.current; if (!current) return;
    const file = filesRef.current.find(f => f.id === id); if (!file) return;
    const filename = file.path || file.name;
    const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${current.id}/delete-file`,roomRef.current,{path:filename,previous:baseline.current.get(filename)?.content ?? null});
    apply(snapshot);
  },[flush,apply]);

  const configure = useCallback(async (testCommand: string) => {
    await flush(); const current = projectRef.current; if (!current) return;
    const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${current.id}/sync`,roomRef.current,{changes:[],activeFileId:activeRef.current,config:{testCommand}});
    merge(snapshot);
  },[flush,merge]);

  const beginAgent = useCallback(async () => {
    await flush(); const current = projectRef.current;
    if (!current) throw new Error('Save or open a project before running Skippy.');
    const result = await workspaceRequest<{token:string}>(`/projects/${current.id}/agent`,roomRef.current,{action:'claim'});
    projectRef.current = {...current, agentBusy:true}; setProject(projectRef.current);
    const interval = setInterval(() => { void workspaceRequest(`/projects/${current.id}/agent`,roomRef.current,{action:'heartbeat',token:result.token}).catch(()=>{}); },8000);
    return async () => { clearInterval(interval); try { await flush(); } finally { await workspaceRequest(`/projects/${current.id}/agent`,roomRef.current,{action:'release',token:result.token}); if (projectRef.current?.id === current.id) { projectRef.current = {...projectRef.current,agentBusy:false}; setProject(projectRef.current); } } };
  },[flush]);

  const resolveConflict = useCallback(async (filename:string, useDisk:boolean) => {
    const conflict = conflictsRef.current.find(c=>c.path===filename); if (!conflict) return;
    if (roomRef.current?.status === 'connected' && projectRef.current) await workspaceRequest(`/projects/${projectRef.current.id}/conflicts`,roomRef.current,{path:filename,useDisk,expectedDisk:conflict.disk?.content ?? null});
    if (useDisk) {
      const updated = filesRef.current.filter(f=>(f.path || f.name)!==filename);
      if (conflict.disk) updated.push(toStored(conflict.disk));
      filesRef.current = updated; setFiles(updated);
    }
    conflictsRef.current = conflictsRef.current.filter(c=>c.path!==filename); setConflicts(conflictsRef.current);
    if (!conflictsRef.current.length) {setError('');setStatus('Changes ready to save'); queueMicrotask(()=>{void flush().catch(err=>setError(err.message));});}
  },[setFiles,flush]);

  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    void refreshProjects().then(async () => {
      const id = room?.workspaceId || localStorage.getItem('skippy-active-project');
      if (id && !cancelled) await open(id,false);
    }).catch(err=>{if(!cancelled)setError(err.message);});
    const off = room?.onAgentEvent(event => {
      if (event.type === 'room-project') void open(event.workspaceId,false).catch(err=>setError(err.message));
      if (event.type === 'workspace-error') setError(event.message);
    });
    return () => {cancelled=true; off?.();};
  },[initialized,room,room?.status,refreshProjects,open]);

  useEffect(() => {
    if (!project || switching.current) return;
    const timer = setTimeout(()=>{void flush().catch(err=>{setError(err.message);setStatus('Save needs attention');});},500);
    return () => clearTimeout(timer);
  },[files,activeFileId,project?.id,flush]);

  useEffect(() => {
    if (!project) return;
    const id = project.id;
    let cancelled = false, running = false;
    const timer = setInterval(async () => {
      if (running || switching.current) return;
      running = true;
      try {
        await serial.current;
        const saveGeneration = serial.current;
        const snapshot = await workspaceRequest<ProjectSnapshot>(`/projects/${id}`,roomRef.current);
        if (!cancelled && projectRef.current?.id === id && saveGeneration === serial.current) merge(snapshot);
      } catch(err) {if(!cancelled)setError((err as Error).message);}
      finally {running=false;}
    },1500);
    return () => {cancelled=true;clearInterval(timer);};
  },[project?.id,merge]);

  useEffect(() => {
    const beforeUnload = (event:BeforeUnloadEvent) => {
      if (projectRef.current && (conflictsRef.current.length || filesRef.current.some(f=>f.content !== baseline.current.get(f.path || f.name)?.content) || baseline.current.size !== filesRef.current.length)) {event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',beforeUnload);
    return () => window.removeEventListener('beforeunload',beforeUnload);
  },[]);

  return {project,projects,checkpoints,conflicts,error,status,busy,open,create,flush,checkpoint,restore,beginAgent,removeFile,configure,resolveConflict,refreshProjects,setError};
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
