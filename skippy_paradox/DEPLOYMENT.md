# CodeCollab V2 — Deployment Guide

This guide walks you through deploying all three CodeCollab services:

| Service | Platform | Purpose |
|---------|----------|---------|
| **Frontend** | Vercel | React SPA (Vite) |
| **Backend API** | Render | FastAPI — GitHub OAuth, API proxy, code execution |
| **Socket Server** | Render | Node.js — Real-time collaboration (Yjs + WebSocket) |

---

## Prerequisites

1. **Accounts** — Sign up for [Vercel](https://vercel.com) and [Render](https://render.com) (both have free tiers).
2. **GitHub OAuth App** — Create one at [github.com/settings/applications/new](https://github.com/settings/applications/new):
   - **Application name**: `CodeCollab` (or anything you like)
   - **Homepage URL**: Your frontend URL (e.g., `https://codecollab.vercel.app`)
   - **Authorization callback URL**: Your backend URL + `/api/auth/github/callback`
     (e.g., `https://codecollab-api.onrender.com/api/auth/github/callback`)
   - Save the **Client ID** and **Client Secret** — you'll need them below.
3. **Gemini API Key** (optional) — Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) for the AI assistant panel.
4. **Judge0 API** (optional) — The default free Community Edition works without a key. For higher limits, get a key at [RapidAPI](https://rapidapi.com/judge0-official/api/judge0-ce).

---

## Step 1: Deploy the Backend API (Render)

### Option A: Using Render Blueprint (recommended)

1. Push your code to GitHub.
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
3. Connect the `Code_CollabV2` repo.
4. Render will auto-detect `render.yaml` and create both services.
5. Set the environment variables when prompted (see table below).

### Option B: Manual setup

1. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**.
2. Connect the `Code_CollabV2` repo.
3. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `codecollab-api` |
| **Root Directory** | `backend` |
| **Runtime** | Python |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Plan** | Free |

4. Add these **Environment Variables**:

| Variable | Value | Required |
|----------|-------|----------|
| `GITHUB_CLIENT_ID` | Your GitHub OAuth App Client ID | Yes |
| `GITHUB_CLIENT_SECRET` | Your GitHub OAuth App Client Secret | Yes |
| `FRONTEND_URL` | Your Vercel frontend URL (e.g., `https://codecollab.vercel.app`) | Yes |
| `FRONTEND_ORIGINS` | Comma-separated allowed origins (e.g., `https://codecollab.vercel.app`) | Yes |
| `BACKEND_PUBLIC_URL` | This Render service URL (e.g., `https://codecollab-api.onrender.com`) | Yes |
| `JUDGE0_API_URL` | `https://judge0-ce.p.rapidapi.com` | No (has default) |
| `JUDGE0_API_KEY` | Your RapidAPI key (if using paid tier) | No |
| `PYTHON_VERSION` | `3.11.6` | No |

5. Click **Create Web Service**.

After deployment, verify: `https://codecollab-api.onrender.com/health` should return `{"status":"ok"}`.

---

## Step 2: Deploy the Socket Server (Render)

> Skip this if you used the Blueprint in Step 1 — it creates both services.

1. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**.
2. Connect the same `Code_CollabV2` repo.
3. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `codecollab-socket` |
| **Root Directory** | `backend-socket` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | Free |

4. Environment variables — Render auto-injects `PORT`. No additional vars needed.

5. Click **Create Web Service**.

After deployment, verify: `https://codecollab-socket.onrender.com/health` should return `{"status":"ok", ...}`.

---

## Step 3: Deploy the Frontend (Vercel)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard) → **Add New** → **Project**.
2. Import the `Code_CollabV2` repo from GitHub.
3. Configure:

| Setting | Value |
|---------|-------|
| **Framework Preset** | Vite |
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

4. Add these **Environment Variables**:

| Variable | Value | Required |
|----------|-------|----------|
| `VITE_API_URL` | Your Render backend URL (e.g., `https://codecollab-api.onrender.com`) | Yes |
| `VITE_COLLAB_URL` | Your Render socket URL (e.g., `https://codecollab-socket.onrender.com`) | Yes |
| `VITE_GEMINI_API_KEYS` | Comma-separated Gemini API keys | No (AI panel won't work without it) |

5. Click **Deploy**.

After deployment, your app should be live at the Vercel URL (e.g., `https://codecollab.vercel.app`).

---

## Step 4: Connect the Services

After all three are deployed, update the cross-references:

### Update GitHub OAuth App
Go to [github.com/settings/developers](https://github.com/settings/developers) → your OAuth App:
- **Homepage URL** → Your Vercel URL
- **Authorization callback URL** → `https://<your-render-backend>/api/auth/github/callback`

### Update Render Backend env vars
- `FRONTEND_URL` → Your Vercel URL (e.g., `https://codecollab.vercel.app`)
- `FRONTEND_ORIGINS` → Your Vercel URL
- `BACKEND_PUBLIC_URL` → The backend's own Render URL (e.g., `https://codecollab-api.onrender.com`)

### Update Vercel Frontend env vars
- `VITE_API_URL` → Your Render backend URL
- `VITE_COLLAB_URL` → Your Render socket server URL

> After changing Vercel env vars, redeploy the frontend (Vercel Dashboard → Deployments → Redeploy).

---

## Custom Domains (Optional)

### Vercel
1. Vercel Dashboard → Project → Settings → Domains → Add your domain.
2. Add the DNS records Vercel provides (CNAME or A record).

### Render
1. Render Dashboard → Service → Settings → Custom Domains → Add your domain.
2. Add the CNAME record Render provides.

Example setup:
- `codecollab.yourdomain.com` → Vercel (frontend)
- `api.codecollab.yourdomain.com` → Render (backend)
- `collab.codecollab.yourdomain.com` → Render (socket server)

After adding custom domains, update all env vars and the GitHub OAuth App callback URL to use the new domains.

---

## Architecture Diagram

```
                        ┌──────────────────────────┐
                        │        Vercel             │
    Users ──────────── │  Frontend (React + Vite)  │
                        └─────────┬────────────────┘
                                  │
                    ┌─────────────┼─────────────────┐
                    │ REST API    │                  │ WebSocket
                    ▼             │                  ▼
           ┌────────────────┐    │    ┌──────────────────────┐
           │     Render     │    │    │       Render          │
           │  FastAPI API   │    │    │  Node.js Socket       │
           │  (OAuth, proxy)│    │    │  (Yjs, rooms, voice)  │
           └───────┬────────┘    │    └──────────────────────┘
                   │             │
                   ▼             │
           ┌────────────────┐   │
           │  GitHub API    │   │
           │  Judge0 API    │   │
           └────────────────┘   │
                                │
                    ┌───────────┘
                    │ Gemini API (client-side)
                    ▼
           ┌────────────────┐
           │  Google AI     │
           │  (Gemini)      │
           └────────────────┘
```

---

## Troubleshooting

### "CORS error" in browser console
- Ensure `FRONTEND_ORIGINS` on the Render backend includes your exact Vercel URL (no trailing slash).
- Check that the Vercel URL uses `https://`, not `http://`.

### GitHub OAuth popup doesn't close / no token
- Verify `BACKEND_PUBLIC_URL` is set to your Render backend URL.
- Verify the GitHub OAuth App callback URL matches: `<BACKEND_PUBLIC_URL>/api/auth/github/callback`.
- Check `FRONTEND_URL` matches your Vercel URL exactly (for `postMessage` origin check).

### WebSocket connection fails
- Render free tier spins down after inactivity. The first connection may take 30-60 seconds.
- Ensure `VITE_COLLAB_URL` points to the socket server URL (not the backend API).
- Check the browser console for the exact WebSocket URL being used.

### Code execution not working
- The default Judge0 CE endpoint has rate limits. If you hit them, sign up for a RapidAPI key.
- Set `JUDGE0_API_KEY` and `JUDGE0_API_HOST` on the Render backend.

### Render free tier cold starts
- Free tier services spin down after 15 minutes of inactivity.
- First request after spin-down takes ~30-60 seconds.
- For production use, consider Render's paid plans to keep services warm.

### Build fails on Vercel
- Make sure the **Root Directory** is set to `frontend` in Vercel project settings.
- Check that Node.js version is 18+ (Vercel default is fine).

### Build fails on Render (Python backend)
- Make sure the **Root Directory** is set to `backend`.
- Ensure `PYTHON_VERSION` env var is set to `3.11.6` or higher.

---

## Environment Variables Reference

### Frontend (Vercel)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API origin | `https://codecollab-api.onrender.com` |
| `VITE_COLLAB_URL` | Socket server origin | `https://codecollab-socket.onrender.com` |
| `VITE_GEMINI_API_KEYS` | Comma-separated Gemini keys | `AIza...abc,AIza...def` |

### Backend API (Render)

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | `Iv1.abc123` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | `abc123secret` |
| `FRONTEND_URL` | Frontend origin for OAuth redirect | `https://codecollab.vercel.app` |
| `FRONTEND_ORIGINS` | CORS allowed origins (comma-separated) | `https://codecollab.vercel.app` |
| `BACKEND_PUBLIC_URL` | This service's public URL | `https://codecollab-api.onrender.com` |
| `JUDGE0_API_URL` | Judge0 endpoint | `https://judge0-ce.p.rapidapi.com` |
| `JUDGE0_API_KEY` | RapidAPI key (optional) | `your-key` |
| `JUDGE0_API_HOST` | RapidAPI host (optional) | `judge0-ce.p.rapidapi.com` |

### Socket Server (Render)

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port (auto-set by Render) | `10000` |
