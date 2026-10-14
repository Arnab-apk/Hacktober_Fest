"""
Judge0 Router — Code execution via Judge0 API with automatic local sandbox fallback.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Header
from .harness import check_access
import asyncio
from pydantic import BaseModel

router = APIRouter()

# OnlineCompiler.io API configuration
ONLINECOMPILER_API_KEY = os.getenv("ONLINECOMPILER_API_KEY", "").strip()
ONLINECOMPILER_API_URL = "https://api.onlinecompiler.io/api/run-code-sync/"

ONLINECOMPILER_MAP = {
    "python": "python-3.14",
    "python3": "python-3.14",
    "javascript": "typescript-deno",
    "node": "typescript-deno",
    "js": "typescript-deno",
    "typescript": "typescript-deno",
    "ts": "typescript-deno",
    "cpp": "g++-15",
    "c++": "g++-15",
    "c": "gcc-15",
    "java": "openjdk-25",
    "csharp": "dotnet-csharp-9",
    "c#": "dotnet-csharp-9",
    "fsharp": "dotnet-fsharp-9",
    "rust": "rust-1.93",
    "go": "go-1.26",
    "ruby": "ruby-4.0",
    "php": "php-8.5",
    "haskell": "haskell-9.12",
}

# Judge0 CE (Community Edition) API endpoint
JUDGE0_API_URL = os.getenv("JUDGE0_API_URL", "https://judge0-ce.p.rapidapi.com").rstrip("/")
JUDGE0_API_KEY = os.getenv("JUDGE0_API_KEY", "")
JUDGE0_API_HOST = os.getenv("JUDGE0_API_HOST", "judge0-ce.p.rapidapi.com")

# Language ID mapping for Judge0
LANGUAGE_IDS = {
    "javascript": 63,  # Node.js
    "python": 71,      # Python 3
    "java": 62,        # Java
    "cpp": 54,         # C++ (GCC 9.2.0)
    "c": 50,           # C (GCC 9.2.0)
    "csharp": 51,      # C# (Mono 6.6.0.161)
    "go": 60,          # Go
    "rust": 73,        # Rust
    "ruby": 72,        # Ruby
    "php": 68,         # PHP
    "typescript": 74,  # TypeScript
    "kotlin": 78,      # Kotlin
    "swift": 83,       # Swift
    "r": 80,           # R
    "sql": 82,         # SQL (SQLite)
    "bash": 46,        # Bash
}


class CodeExecutionRequest(BaseModel):
    source_code: str
    language: str
    stdin: Optional[str] = ""
    expected_output: Optional[str] = None


class CodeExecutionResponse(BaseModel):
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    compile_output: Optional[str] = None
    message: Optional[str] = None
    status: dict
    time: Optional[str] = None
    memory: Optional[int] = None


def _run_local_process(code: str, language: str, stdin: str = "") -> CodeExecutionResponse | None:
    """Run code locally using system interpreters/compilers when available."""
    lang = language.lower()
    start_time = time.time()

    # 1. Python
    if lang == "python":
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
            tmp_path = f.name
        try:
            proc = subprocess.run(
                [sys.executable, tmp_path],
                input=stdin or "",
                capture_output=True,
                text=True,
                timeout=10.0,
            )
            elapsed = f"{time.time() - start_time:.3f}"
            status_id = 3 if proc.returncode == 0 else 4
            status_desc = "Accepted" if proc.returncode == 0 else "Runtime Error"
            return CodeExecutionResponse(
                stdout=proc.stdout or None,
                stderr=proc.stderr or None,
                status={"id": status_id, "description": status_desc},
                time=elapsed,
            )
        except subprocess.TimeoutExpired:
            return CodeExecutionResponse(
                stdout=None,
                stderr="Execution timed out after 10.0 seconds.",
                status={"id": 5, "description": "Time Limit Exceeded"},
                time="10.000",
            )
        finally:
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except Exception: pass

    # 2. JavaScript / Node.js
    if lang in ("javascript", "node", "js"):
        node_bin = shutil.which("node") or "node"
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(code)
            tmp_path = f.name
        try:
            proc = subprocess.run(
                [node_bin, tmp_path],
                input=stdin or "",
                capture_output=True,
                text=True,
                timeout=10.0,
            )
            elapsed = f"{time.time() - start_time:.3f}"
            status_id = 3 if proc.returncode == 0 else 4
            status_desc = "Accepted" if proc.returncode == 0 else "Runtime Error"
            return CodeExecutionResponse(
                stdout=proc.stdout or None,
                stderr=proc.stderr or None,
                status={"id": status_id, "description": status_desc},
                time=elapsed,
            )
        except subprocess.TimeoutExpired:
            return CodeExecutionResponse(
                stdout=None,
                stderr="Execution timed out after 10.0 seconds.",
                status={"id": 5, "description": "Time Limit Exceeded"},
                time="10.000",
            )
        except FileNotFoundError:
            return None
        finally:
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except Exception: pass

    # 3. C++
    if lang in ("cpp", "c++"):
        gpp = shutil.which("g++")
        if gpp:
            with tempfile.NamedTemporaryFile("w", suffix=".cpp", delete=False, encoding="utf-8") as f:
                f.write(code)
                src_path = f.name
            out_bin = src_path + (".exe" if os.name == "nt" else ".out")
            try:
                comp = subprocess.run([gpp, src_path, "-O2", "-o", out_bin], capture_output=True, text=True, timeout=10.0)
                if comp.returncode != 0:
                    return CodeExecutionResponse(
                        stdout=None,
                        stderr=comp.stderr,
                        compile_output=comp.stderr,
                        status={"id": 6, "description": "Compilation Error"},
                        time=f"{time.time() - start_time:.3f}",
                    )
                proc = subprocess.run([out_bin], input=stdin or "", capture_output=True, text=True, timeout=10.0)
                elapsed = f"{time.time() - start_time:.3f}"
                status_id = 3 if proc.returncode == 0 else 4
                return CodeExecutionResponse(
                    stdout=proc.stdout or None,
                    stderr=proc.stderr or None,
                    status={"id": status_id, "description": "Accepted" if status_id == 3 else "Runtime Error"},
                    time=elapsed,
                )
            except subprocess.TimeoutExpired:
                return CodeExecutionResponse(
                    stdout=None,
                    stderr="Execution timed out after 10.0 seconds.",
                    status={"id": 5, "description": "Time Limit Exceeded"},
                    time="10.000",
                )
            finally:
                for p in (src_path, out_bin):
                    if os.path.exists(p):
                        try: os.remove(p)
                        except Exception: pass

    # 4. C
    if lang == "c":
        gcc = shutil.which("gcc")
        if gcc:
            with tempfile.NamedTemporaryFile("w", suffix=".c", delete=False, encoding="utf-8") as f:
                f.write(code)
                src_path = f.name
            out_bin = src_path + (".exe" if os.name == "nt" else ".out")
            try:
                comp = subprocess.run([gcc, src_path, "-O2", "-o", out_bin], capture_output=True, text=True, timeout=10.0)
                if comp.returncode != 0:
                    return CodeExecutionResponse(
                        stdout=None,
                        stderr=comp.stderr,
                        compile_output=comp.stderr,
                        status={"id": 6, "description": "Compilation Error"},
                        time=f"{time.time() - start_time:.3f}",
                    )
                proc = subprocess.run([out_bin], input=stdin or "", capture_output=True, text=True, timeout=10.0)
                elapsed = f"{time.time() - start_time:.3f}"
                status_id = 3 if proc.returncode == 0 else 4
                return CodeExecutionResponse(
                    stdout=proc.stdout or None,
                    stderr=proc.stderr or None,
                    status={"id": status_id, "description": "Accepted" if status_id == 3 else "Runtime Error"},
                    time=elapsed,
                )
            except subprocess.TimeoutExpired:
                return CodeExecutionResponse(
                    stdout=None,
                    stderr="Execution timed out after 10.0 seconds.",
                    status={"id": 5, "description": "Time Limit Exceeded"},
                    time="10.000",
                )
            finally:
                for p in (src_path, out_bin):
                    if os.path.exists(p):
                        try: os.remove(p)
                        except Exception: pass

    # 5. Java
    if lang == "java":
        javac = shutil.which("javac")
        java_bin = shutil.which("java")
        if javac and java_bin:
            tmp_dir = tempfile.mkdtemp()
            src_path = os.path.join(tmp_dir, "Main.java")
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(code)
            try:
                comp = subprocess.run([javac, "Main.java"], cwd=tmp_dir, capture_output=True, text=True, timeout=10.0)
                if comp.returncode != 0:
                    return CodeExecutionResponse(
                        stdout=None,
                        stderr=comp.stderr,
                        compile_output=comp.stderr,
                        status={"id": 6, "description": "Compilation Error"},
                        time=f"{time.time() - start_time:.3f}",
                    )
                proc = subprocess.run([java_bin, "Main"], cwd=tmp_dir, input=stdin or "", capture_output=True, text=True, timeout=10.0)
                elapsed = f"{time.time() - start_time:.3f}"
                status_id = 3 if proc.returncode == 0 else 4
                return CodeExecutionResponse(
                    stdout=proc.stdout or None,
                    stderr=proc.stderr or None,
                    status={"id": status_id, "description": "Accepted" if status_id == 3 else "Runtime Error"},
                    time=elapsed,
                )
            except subprocess.TimeoutExpired:
                return CodeExecutionResponse(
                    stdout=None,
                    stderr="Execution timed out after 10.0 seconds.",
                    status={"id": 5, "description": "Time Limit Exceeded"},
                    time="10.000",
                )
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

async def _run_onlinecompiler(code: str, language: str, stdin: str = "") -> CodeExecutionResponse | None:
    """Run code via OnlineCompiler.io synchronous API."""
    if not ONLINECOMPILER_API_KEY:
        return None
    compiler_id = ONLINECOMPILER_MAP.get(language.lower())
    if not compiler_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                ONLINECOMPILER_API_URL,
                headers={
                    "Authorization": ONLINECOMPILER_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "compiler": compiler_id,
                    "code": code,
                    "input": stdin or "",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                is_success = data.get("status") == "success" and data.get("exit_code", 0) == 0
                status_id = 3 if is_success else 4
                desc = "Accepted" if is_success else f"Error (Exit {data.get('exit_code')})"
                raw_mem = data.get("memory")
                mem_kb = None
                if raw_mem:
                    try:
                        mem_kb = int(float(raw_mem))
                    except Exception:
                        pass
                return CodeExecutionResponse(
                    stdout=data.get("output") or None,
                    stderr=data.get("error") or None,
                    status={"id": status_id, "description": desc},
                    time=str(data.get("time")) if data.get("time") is not None else None,
                    memory=mem_kb,
                )
    except Exception as e:
        print(f"OnlineCompiler API warning: {e}")
    return None


def infer_language_from_code(code: str) -> str:
    c = code.strip()
    if not c:
        return "python"
    if re.search(r"\b(def\s+\w+|import\s+\w+|from\s+\w+\s+import|print\s*\(|elif\s+|if\s+__name__\s*==|class\s+\w+:)", c):
        return "python"
    if re.search(r"\b(console\.log|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|function\s*\(|=>)", c):
        return "javascript"
    if re.search(r"#include\s*<iostream>|std::|cout\s*<<", c):
        return "cpp"
    if re.search(r"#include\s*<stdio\.h>|printf\s*\(", c):
        return "c"
    if re.search(r"\b(public\s+class|System\.out\.print|public\s+static\s+void\s+main)", c):
        return "java"
    if re.search(r"\b(package\s+main|func\s+main\(\)|fmt\.Print)", c):
        return "go"
    if re.search(r"\b(fn\s+main\(\)|println!\s*\(|let\s+mut\s+)", c):
        return "rust"
    if re.search(r"\b(using\s+System|Console\.WriteLine)", c):
        return "csharp"
    if re.search(r"<\?php|\b(\$_POST|\$_GET|\$this->)", c):
        return "php"
    if re.search(r"\b(puts\s+|def\s+\w+.*end|require\s+['\"])", c):
        return "ruby"
    if re.search(r"^#!/bin/(bash|sh)|\becho\s+", c, re.M):
        return "bash"
    if re.search(r"\b(SELECT\s+.*FROM|INSERT\s+INTO|CREATE\s+TABLE)", c, re.I):
        return "sql"
    return "python"


@router.post("/execute", response_model=CodeExecutionResponse)
async def execute_code(request: CodeExecutionRequest, http_request: Request, authorization: str | None = Header(None)):
    check_access(http_request, authorization)
    """
    Execute code using OnlineCompiler.io, local sandbox execution, or Judge0 API.
    """
    raw_lang = (request.language or "").strip().lower()
    alias_map = {
        "py": "python",
        "python3": "python",
        "js": "javascript",
        "node": "javascript",
        "ts": "typescript",
        "c++": "cpp",
        "c#": "csharp",
        "rb": "ruby",
        "rs": "rust",
        "sh": "bash",
        "shell": "bash",
    }
    lang = alias_map.get(raw_lang, raw_lang)

    # If language is unknown or empty, infer from code
    if not lang or (lang not in LANGUAGE_IDS and lang not in ONLINECOMPILER_MAP):
        lang = infer_language_from_code(request.source_code)


    # 1. Try OnlineCompiler.io
    oc_res = await _run_onlinecompiler(request.source_code, lang, request.stdin or "")
    if oc_res is not None:
        return oc_res

    # 2. Try local sandbox execution (Python, Node, C, C++, Java)
    local_res = await asyncio.to_thread(_run_local_process, request.source_code, lang, request.stdin or "")
    if local_res is not None:
        return local_res

    # Language ID for Judge0
    language_id = LANGUAGE_IDS.get(lang)
    if not language_id:
        local_res = await asyncio.to_thread(_run_local_process, request.source_code, lang, request.stdin or "")
        if local_res is not None:
            return local_res
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {request.language}. Supported: {', '.join(LANGUAGE_IDS.keys())}"
        )

    # Prepare submission
    submission_data = {
        "source_code": request.source_code,
        "language_id": language_id,
        "stdin": request.stdin or "",
    }
    if request.expected_output:
        submission_data["expected_output"] = request.expected_output

    headers = {"content-type": "application/json"}
    if JUDGE0_API_KEY:
        headers["X-RapidAPI-Key"] = JUDGE0_API_KEY
        headers["X-RapidAPI-Host"] = JUDGE0_API_HOST

    # If no Judge0 key is configured or URL is default rapidapi, use local subprocess execution
    if not JUDGE0_API_KEY:
        import subprocess
        import tempfile
        import time

        lang = request.language.lower()
        start_time = time.time()
        
        try:
            if lang in ["javascript", "js", "typescript", "ts"]:
                # Execute with node
                with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
                    tf.write(request.source_code)
                    temp_path = tf.name
                
                proc = subprocess.run(
                    ["node", temp_path],
                    input=request.stdin or "",
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                os.remove(temp_path)
                elapsed = f"{time.time() - start_time:.3f}s"
                
                return CodeExecutionResponse(
                    stdout=proc.stdout or None,
                    stderr=proc.stderr or None,
                    compile_output=None,
                    message=None,
                    status={"id": 3 if proc.returncode == 0 else 4, "description": "Accepted" if proc.returncode == 0 else "Error"},
                    time=elapsed,
                    memory=1024,
                )

            elif lang in ["python", "py"]:
                # Execute with python
                with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as tf:
                    tf.write(request.source_code)
                    temp_path = tf.name

                proc = subprocess.run(
                    ["python", temp_path],
                    input=request.stdin or "",
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                os.remove(temp_path)
                elapsed = f"{time.time() - start_time:.3f}s"

                return CodeExecutionResponse(
                    stdout=proc.stdout or None,
                    stderr=proc.stderr or None,
                    compile_output=None,
                    message=None,
                    status={"id": 3 if proc.returncode == 0 else 4, "description": "Accepted" if proc.returncode == 0 else "Error"},
                    time=elapsed,
                    memory=1024,
                )
        except subprocess.TimeoutExpired:
            return CodeExecutionResponse(
                stdout=None,
                stderr="Execution timed out after 15s",
                compile_output=None,
                message="Time Limit Exceeded",
                status={"id": 5, "description": "Time Limit Exceeded"},
                time="15.0s",
                memory=0,
            )
        except Exception as local_err:
            # Fall through to try HTTP if local fails
            pass

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{JUDGE0_API_URL}/submissions?base64_encoded=false&wait=true",
                json=submission_data,
                headers=headers,
            )
            response.raise_for_status()
            result = response.json()

            return CodeExecutionResponse(
                stdout=result.get("stdout"),
                stderr=result.get("stderr"),
                compile_output=result.get("compile_output"),
                message=result.get("message"),
                status=result.get("status", {}),
                time=result.get("time"),
                memory=result.get("memory"),
            )

    except Exception as e:
        # Final fallback: execute locally with python or node
        try:
            import subprocess
            import tempfile
            import time

            lang = request.language.lower()
            start_time = time.time()
            cmd = ["node"] if lang in ["javascript", "js", "typescript", "ts"] else ["python"]
            suffix = ".js" if lang in ["javascript", "js", "typescript", "ts"] else ".py"
            
            with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8") as tf:
                tf.write(request.source_code)
                temp_path = tf.name

            proc = subprocess.run(
                [*cmd, temp_path],
                input=request.stdin or "",
                capture_output=True,
                text=True,
                timeout=15
            )
            os.remove(temp_path)
            elapsed = f"{time.time() - start_time:.3f}s"

            return CodeExecutionResponse(
                stdout=proc.stdout or None,
                stderr=proc.stderr or None,
                compile_output=None,
                message=None,
                status={"id": 3 if proc.returncode == 0 else 4, "description": "Accepted" if proc.returncode == 0 else "Error"},
                time=elapsed,
                memory=1024,
            )
        except Exception as fallback_err:
            raise HTTPException(status_code=500, detail=f"Execution failed: {str(e)} | Local: {str(fallback_err)}")


@router.get("/languages")
async def get_supported_languages():
    """Get list of supported languages."""
    return {
        "languages": [
            {"id": lang_id, "name": lang_name, "display": lang_name.title()}
            for lang_name, lang_id in LANGUAGE_IDS.items()
        ]
    }


@router.get("/status")
async def get_judge0_status():
    """Check Judge0 API status."""
    headers = {}
    if JUDGE0_API_KEY:
        headers["X-RapidAPI-Key"] = JUDGE0_API_KEY
        headers["X-RapidAPI-Host"] = JUDGE0_API_HOST

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{JUDGE0_API_URL}/about",
                headers=headers,
            )
            response.raise_for_status()
            return {"status": "ok", "judge0": response.json()}
    except Exception as e:
        return {"status": "ok", "mode": "local_fallback", "message": str(e)}
