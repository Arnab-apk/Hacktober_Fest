# Hosted deployment

- Frontend: https://hacktober-aot.vercel.app
- API: https://hacktober-aot-api.onrender.com
- Collaboration and workspaces: https://hacktober-aot-collab.onrender.com
- Repository: https://github.com/Arnab-apk/Hacktober_Fest
- Production branch: arnab

## Access and AI

The generated server access token is saved only in the ignored local .env.deploy file and the Render environment settings. Enter its SKIPPY_ACCESS_TOKEN value in the app's Harness settings to use hosted workspaces and AI. Never commit that file or place the token in VITE_* variables.

Select Gemma 4 / Gemini API in the AI provider dropdown. The existing Gemini key is stored on the API service. Ollama needs a separately reachable model server; the hosted services cannot reach Ollama on your laptop's localhost. OpenRouter and GitHub OAuth need their own credentials before use; GitHub PAT import/push can be configured separately.

## Future releases

Commit and push to arnab. Render services and Vercel are connected to the repository. Vercel uses skippy_paradox/frontend, npm ci, npm run build, and dist. Its VITE_API_URL and VITE_COLLAB_URL settings point to Render.

The API installs root requirements.txt, including the Skippy harness, and starts uvicorn from skippy_paradox/backend. The collaboration service builds deployment/socket.Dockerfile so Node PTY terminals have Python and the harness available. Both services use free plans.

## Limits and checks

Free Render services can sleep. Workspace files are on ephemeral service storage and can be lost on restart or redeploy; export or push important projects to GitHub. Live rooms are held in memory. Local checks: npm run typecheck, npm run build, npm run test:github, and Python bridge tests. The hosted two-client collaboration check uses COLLAB_TEST_URL=wss://hacktober-aot-collab.onrender.com. Render's proxy can report unauthorized WebSocket closure as 1006 rather than 4001; the test also verifies that no document data is delivered.
