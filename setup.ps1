$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $PSScriptRoot '.cache/uv'
uv venv --python 3.10 .venv310
if ($LASTEXITCODE -ne 0) { throw 'Could not create Python environment.' }
uv pip install --python .venv310/Scripts/python.exe -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Could not install Python dependencies.' }
npm.cmd ci --prefix skippy_paradox/frontend --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Could not install frontend dependencies.' }
npm.cmd ci --prefix skippy_paradox/backend-socket --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Could not install collaboration dependencies.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
Write-Host 'Setup complete. Run npm.cmd start and open http://localhost:3100.'
