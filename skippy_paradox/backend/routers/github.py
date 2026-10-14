"""
GitHub API proxy router.
Proxies requests to GitHub API with the user's access token,
avoiding CORS issues from the browser.
"""

from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import PlainTextResponse

router = APIRouter()

GITHUB_API = "https://api.github.com"
ALLOWED_DOWNLOAD_DOMAINS = {
    "raw.githubusercontent.com",
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "media.githubusercontent.com",
}


def _gh_headers(authorization: str | None) -> dict:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    return {
        "Authorization": authorization,
        "Accept": "application/vnd.github.v3+json",
    }


@router.get("/user")
async def get_user(authorization: str = Header()):
    """Get the authenticated GitHub user."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{GITHUB_API}/user", headers=_gh_headers(authorization))
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to fetch GitHub user")
    data = resp.json()
    return {"login": data["login"], "avatar_url": data["avatar_url"], "name": data.get("name")}


@router.get("/repos")
async def list_repos(
    authorization: str = Header(),
    page: int = Query(1),
    per_page: int = Query(100),
    sort: str = Query("updated"),
):
    """List the authenticated user's repositories."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GITHUB_API}/user/repos",
            params={
                "per_page": per_page,
                "page": page,
                "sort": sort,
                "affiliation": "owner,collaborator,organization_member",
            },
            headers=_gh_headers(authorization),
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to fetch repos")
    return resp.json()


@router.get("/repos/{owner}/{repo}/contents")
async def get_contents(
    owner: str,
    repo: str,
    authorization: str = Header(),
    path: str = Query(""),
):
    """Get contents (files/dirs) of a repository path."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents"
    if path:
        url += f"/{path}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=_gh_headers(authorization))
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Failed to fetch contents for {owner}/{repo}")
    return resp.json()


@router.get("/file")
async def fetch_file(
    url: str = Query(..., description="The raw download URL of the file"),
    authorization: str | None = Header(None),
):
    """Fetch raw file content from a download URL."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.netloc.lower() not in ALLOWED_DOWNLOAD_DOMAINS:
        raise HTTPException(400, "URL host is not permitted. Only GitHub URLs can be proxied.")

    headers = {}
    if authorization:
        headers["Authorization"] = authorization
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to fetch file")
    return PlainTextResponse(resp.text)


@router.get("/repos/{owner}/{repo}/tree/{branch}")
async def get_repo_tree(
    owner: str,
    repo: str,
    branch: str,
    authorization: str = Header(),
):
    """
    Fetch the full recursive tree of a repository.
    Returns all files/dirs in one call using Git Trees API.
    """
    url = f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=_gh_headers(authorization))
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Failed to fetch tree for {owner}/{repo}")
    data = resp.json()
    # Return only what the frontend needs: path, type, size, sha
    tree = []
    for item in data.get("tree", []):
        tree.append({
            "path": item["path"],
            "type": item["type"],  # "blob" = file, "tree" = dir
            "size": item.get("size", 0),
            "sha": item["sha"],
        })
    return {"tree": tree, "sha": data.get("sha"), "truncated": data.get("truncated", False)}
