"""
CodeCollab Backend — FastAPI server for GitHub OAuth & API proxy.
"""

import os
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from routers import auth, github, judge0, harness, gemma  # noqa: E402

@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10), limits=httpx.Limits(max_connections=8, max_keepalive_connections=4)) as client:
        app.state.gemma_client = client
        yield

app = FastAPI(title="Skiffy API", version="1.0.0", lifespan=lifespan)

DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
    "https://skiffy-lilac.vercel.app",
    "https://codecollab.noharafamily.xyz",
]
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
FRONTEND_ORIGINS = os.getenv("FRONTEND_ORIGINS", "")
custom_origins = [origin.strip().rstrip("/") for origin in FRONTEND_ORIGINS.split(",") if origin.strip()]
if FRONTEND_URL and FRONTEND_URL not in custom_origins:
    custom_origins.append(FRONTEND_URL)

ALLOWED_ORIGINS = list(dict.fromkeys(DEFAULT_ORIGINS + custom_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(github.router, prefix="/api/github", tags=["GitHub"])
app.include_router(judge0.router, prefix="/api/judge0", tags=["Judge0"])
app.include_router(harness.router, prefix="/api/harness", tags=["Harness"])
app.include_router(gemma.router, prefix="/api/gemma", tags=["Gemma"])


@app.get("/")
def root_health():
    return {"status": "ok", "service": "Skiffy API"}


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    port = int(os.getenv("BACKEND_PORT", "8000"))
    reload_enabled = os.getenv("BACKEND_RELOAD", "true").lower() in {"1", "true", "yes", "on"}

    uvicorn.run("main:app", host=host, port=port, reload=reload_enabled)
