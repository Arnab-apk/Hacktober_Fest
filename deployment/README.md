# Hosted deployment

- Frontend: https://hacktober-aot.vercel.app
- API: https://hacktober-aot-api.onrender.com
- Collaboration and workspaces: https://hacktober-aot-collab.onrender.com
- Repository: https://github.com/Arnab-apk/Hacktober_Fest
- Production branch: arnab

## Access and AI

The generated server access token is saved only in the ignored local .env.deploy file and the Render environment settings. Enter its SKIPPY_ACCESS_TOKEN value in the app's Harness settings to use hosted workspaces and AI. Never commit that file or place the token in VITE_* variables.

The hosted agent and Gemma tutor default to OpenRouter. Provider credentials are configured on Render and are never included in the frontend bundle. The agent lists the available OpenRouter tool-capable text models and Gemini text models; the tutor offers both Gemma 4 sizes through OpenRouter, including free routes that may be rate-limited. Google currently returns an internal error for its Gemma routes, so select OpenRouter for Gemma. Gemini agent models remain selectable. Ollama requires a separately reachable model server; the hosted services cannot reach Ollama on your laptop's localhost. GitHub OAuth still requires its own application credentials; GitHub PAT import/push can be configured separately. New workspace terminals inherit the selected provider and the server's model credentials.

## Future releases

Commit and push to arnab. Vercel automatically deploys the production branch. Render services use the public repository URL and need a manual deploy from the dashboard or API after a push; automatic updates require connecting the GitHub provider or a deploy-hook workflow. Vercel uses skippy_paradox/frontend, npm ci, npm run build, and dist. Its VITE_API_URL and VITE_COLLAB_URL settings point to Render.

The API installs root requirements.txt, including the Skippy harness, and starts uvicorn from skippy_paradox/backend. The collaboration service builds deployment/socket.Dockerfile so Node PTY terminals have Python and the harness available. Both services use free plans.

## Limits and checks

Free Render services can sleep. Workspace files are on ephemeral service storage and can be lost on restart or redeploy; export or push important projects to GitHub. Live rooms are held in memory. Local checks: npm run typecheck, npm run build, npm run test:github, and Python bridge tests. The hosted two-client collaboration check uses COLLAB_TEST_URL=wss://hacktober-aot-collab.onrender.com. Render's proxy can report unauthorized WebSocket closure as 1006 rather than 4001; the test also verifies that no document data is delivered.
