"""Streaming bridge to the actual Skippy package, isolated per request."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter()
ROOT = Path(__file__).resolve().parents[3]
RUNS = {}
MODEL_CACHE = {}


class WorkspaceFile(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=1_000_000)


class HistoryMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=32000)


class RunRequest(BaseModel):
    provider: Literal['ollama', 'openrouter', 'gemini'] = 'ollama'
    model: str = Field(default='', max_length=200)
    apiKey: str = Field(default='', max_length=500)
    prompt: str = Field(default='', max_length=32000)
    files: list[WorkspaceFile] = Field(default_factory=list, max_length=300)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=12)


def server_body(body):
    payload = body.model_dump()
    if body.provider != 'ollama':
        env_key = 'GEMINI_API_KEY' if body.provider == 'gemini' else 'OPENROUTER_API_KEY'
        # A server key takes precedence over legacy personal browser keys.
        payload['apiKey'] = os.getenv(env_key, '').strip() or body.apiKey.strip()
        if not payload['apiKey']:
            raise HTTPException(503, f'Set {env_key} in the server .env and restart the app.')
    return payload


def launch(body, directory):
    env = os.environ.copy()
    env['PYTHONPATH'] = str(ROOT / 'Skippy_harness')
    env['PYTHONIOENCODING'] = 'utf-8'
    # Never expose service credentials to shell commands through the environment.
    for key in list(env):
        if any(word in key.upper() for word in ('TOKEN', 'SECRET', 'API_KEY')):
            env.pop(key)
    process = subprocess.Popen([sys.executable, '-u', '-m', 'skippy_harness.web_worker'],
                               cwd=directory, env=env, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               text=True, encoding='utf-8',
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    process.stdin.write(json.dumps(body) + '\n')
    process.stdin.flush()
    return process


def stop(process):
    if process.poll() is None:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            process.kill()
        process.wait(timeout=10)


def check_access(request, authorization):
    configured = os.getenv('SKIPPY_ACCESS_TOKEN', '')
    if configured and not secrets.compare_digest(authorization or '', 'Bearer ' + configured):
        raise HTTPException(401, 'Enter the server access token in Harness settings.')
    # A local-only default: remote use requires an explicitly configured access token.
    if not configured:
        host = request.headers.get('host', '').split(':')[0]
        origin = urlparse(request.headers.get('origin', '')).hostname
        forwarded = request.headers.get('x-forwarded-host', '').split(':')[0]
        local = {'localhost', '127.0.0.1', 'testserver'}
        if host not in local or (origin and origin not in local) or (forwarded and forwarded not in local):
            raise HTTPException(403, 'Set SKIPPY_ACCESS_TOKEN on the server for remote access.')


@router.get('/health')
def health():
    return {'status': 'ok', 'providers': ['ollama', 'openrouter', 'gemini'],
            'shellEnabled': os.getenv('SKIPPY_ALLOW_SHELL', '').lower() == 'true',
            'requiresToken': bool(os.getenv('SKIPPY_ACCESS_TOKEN'))}


@router.post('/models')
async def models(body: RunRequest, request: Request, authorization: str | None = Header(None)):
    check_access(request, authorization)
    payload = server_body(body)
    # Cache catalogs, never model answers. Include key digest to avoid cross-key reuse.
    cache_key = (body.provider, hashlib.sha256(payload.get('apiKey', '').encode()).hexdigest(), os.getenv('OLLAMA_BASE_URL', ''))
    cached = MODEL_CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < 60:
        return cached[1]
    with tempfile.TemporaryDirectory(prefix='skippy-models-') as directory:
        process = launch({**payload, 'action': 'models'}, directory)
        try:
            result = await asyncio.wait_for(asyncio.to_thread(process.stdout.readline), 25)
            data = json.loads(result or '{}')
            if data.get('type') != 'models':
                raise HTTPException(502, data.get('message', 'Could not load models. Check provider and runtime dependencies.'))
            if body.provider == 'gemini':
                data['models'] = [m for m in data.get('models', []) if m.startswith('gemma-4-')]
            if len(MODEL_CACHE) >= 32:
                MODEL_CACHE.clear()
            MODEL_CACHE[cache_key] = (time.monotonic(), data)
            return data
        except asyncio.TimeoutError:
            raise HTTPException(504, 'Model discovery timed out. Check that Ollama is running.')
        finally:
            stop(process)
            process.stdin.close()
            process.stdout.close()


@router.post('/runs')
async def run(body: RunRequest, request: Request, authorization: str | None = Header(None)):
    check_access(request, authorization)
    if not body.prompt.strip() or not body.model.strip():
        raise HTTPException(400, 'Choose a model and enter a prompt.')
    if len(RUNS) >= 4:
        raise HTTPException(429, 'All four harness slots are busy. Try again shortly.')
    if sum(len(f.content) for f in body.files) > 5_000_000:
        raise HTTPException(413, 'Workspace exceeds 5 MB. Share a smaller set of files.')
    payload = server_body(body)
    run_id, token = secrets.token_urlsafe(20), secrets.token_urlsafe(32)

    async def stream():
        with tempfile.TemporaryDirectory(prefix='skippy-run-') as directory:
            process = launch(payload, directory)
            entry = {'process': process, 'token': token, 'approval': False}
            RUNS[run_id] = entry
            yield json.dumps({'type': 'started', 'runId': run_id, 'token': token}) + '\n'
            started = time.monotonic()
            pending = None
            try:
                while time.monotonic() - started < 1800:
                    if await request.is_disconnected():
                        break
                    if pending is None:
                        pending = asyncio.create_task(asyncio.to_thread(process.stdout.readline))
                    ready, _ = await asyncio.wait({pending}, timeout=1)
                    if not ready:
                        yield '{"type":"heartbeat"}\n'
                        continue
                    line = pending.result()
                    pending = None
                    if not line:
                        yield '{"type":"error","message":"Harness worker exited unexpectedly. Check runtime dependencies."}\n'
                        break
                    event = json.loads(line)
                    if event['type'] == 'approval':
                        entry['approval'] = True
                    yield line.replace(payload['apiKey'], '[redacted]') if payload.get('apiKey') else line
                    if event['type'] in {'done', 'error'}:
                        break
                else:
                    yield '{"type":"error","message":"Run exceeded 30 minutes."}\n'
            finally:
                stop(process)
                if pending:
                    await pending
                process.stdin.close()
                process.stdout.close()
                RUNS.pop(run_id, None)
    return StreamingResponse(stream(), media_type='application/x-ndjson',
                             headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


class Decision(BaseModel):
    approved: bool


def owned_run(run_id, token):
    run = RUNS.get(run_id)
    if not run or not secrets.compare_digest(token or '', run['token']):
        raise HTTPException(404, 'Run not found or expired.')
    return run


@router.post('/runs/{run_id}/approval')
def approve(run_id: str, body: Decision, x_run_token: str | None = Header(None)):
    run = owned_run(run_id, x_run_token)
    if not run['approval']:
        raise HTTPException(409, 'No command is awaiting approval.')
    run['approval'] = False
    run['process'].stdin.write(json.dumps(body.model_dump()) + '\n')
    run['process'].stdin.flush()
    return {'ok': True}


@router.delete('/runs/{run_id}')
def cancel(run_id: str, x_run_token: str | None = Header(None)):
    stop(owned_run(run_id, x_run_token)['process'])
    return {'ok': True}
