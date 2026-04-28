# Deployment Shortcuts (Windows ECS)

These scripts are intended for a repo located at:

`C:\apps\Downaigc`

## One-command deploy

```powershell
cd C:\apps\Downaigc\scripts
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

What it does:
- Stops old processes on ports `5173` and `8000`
- Pulls latest code from `origin/main`
- Installs backend/frontend dependencies
- Builds frontend
- Starts backend (`uvicorn`) and frontend (`vite preview`)

## One-command rollback

```powershell
cd C:\apps\Downaigc\scripts
powershell -ExecutionPolicy Bypass -File .\rollback.ps1
```

What it does:
- Reads the last deployed commit snapshot from `.deploy/last-deploy.json`
- Checks out previous commit
- Rebuilds frontend
- Restarts frontend/backend

## Manual start/stop

Start:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1 -UsePreview
```

Stop:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-all.ps1
```
