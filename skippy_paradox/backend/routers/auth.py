"""
GitHub OAuth authentication router.

Flow:
1. Frontend opens popup to  GET /api/auth/github
2. Backend redirects to GitHub OAuth consent screen
3. GitHub redirects back to GET /api/auth/github/callback?code=...
4. Backend exchanges code → access_token via GitHub API
5. Backend returns an HTML page that sends the token to the parent
   window via postMessage, then closes itself.
"""

import os
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

router = APIRouter()


def _to_origin(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return url.rstrip("/")

CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
FRONTEND_ORIGIN = _to_origin(FRONTEND_URL)
BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "").rstrip("/")

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# For OAuth Apps, private-repo read-only is not available.
# "repo" grants read/write access for private repositories.
SCOPES = os.getenv("GITHUB_OAUTH_SCOPES", "repo read:org read:user")


@router.get("/github")
def github_login():
    """Redirect browser (popup) to GitHub OAuth consent page."""
    if not CLIENT_ID:
        raise HTTPException(500, "GITHUB_CLIENT_ID not configured")

    redirect_base = BACKEND_PUBLIC_URL or FRONTEND_URL
    params = urlencode({
        "client_id": CLIENT_ID,
        "scope": SCOPES,
        "redirect_uri": f"{redirect_base}/api/auth/github/callback",
    })
    return RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{params}")


@router.get("/github/callback")
async def github_callback(code: str | None = None, error: str | None = None):
    """
    GitHub redirects here after the user authorises.
    Exchange the code for an access token and post it back to the opener.
    """
    if error or not code:
        return HTMLResponse(_post_message_html(None, error or "Authorization denied"), status_code=200)

    if not CLIENT_ID or not CLIENT_SECRET:
        raise HTTPException(500, "GitHub OAuth credentials not configured")

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )

    if resp.status_code != 200:
        return HTMLResponse(_post_message_html(None, "Token exchange failed"), status_code=200)

    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        err = data.get("error_description", data.get("error", "Unknown error"))
        return HTMLResponse(_post_message_html(None, err), status_code=200)

    return HTMLResponse(_post_message_html(access_token, None), status_code=200)


def _post_message_html(token: str | None, error: str | None) -> str:
    """
    Minimal HTML page that sends the OAuth result back to the parent
    window (the main CodeCollab tab) and closes the popup.
    """
    payload_parts = ['type: "github-oauth"']
    if token:
        safe_token = token.replace('"', '\\"').replace("\n", " ")
        payload_parts.append(f'token: "{safe_token}"')
    if error:
        safe_err = error.replace('"', '\\"').replace("\n", " ")
        payload_parts.append(f'error: "{safe_err}"')

    payload = "{ " + ", ".join(payload_parts) + " }"

    return f"""<!DOCTYPE html>
<html>
<head><title>Authenticating…</title></head>
<body>
<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#888">
  Completing authentication…
</p>
<script>
    const payload = {payload};
    try {{
        localStorage.setItem("codecollab-github-oauth-result", JSON.stringify(payload));
    }} catch (_) {{
        // Ignore storage failures (private mode / disabled storage).
    }}

    const sendResult = () => {{
        if (!window.opener) return;
        window.opener.postMessage(payload, "{FRONTEND_ORIGIN}");
    }};

  if (window.opener) {{
            // Send a few times and close slightly later to avoid first-time popup race conditions.
            sendResult();
            window.setTimeout(sendResult, 50);
            window.setTimeout(sendResult, 150);
  }}

    window.setTimeout(() => window.close(), 300);
</script>
</body>
</html>"""
