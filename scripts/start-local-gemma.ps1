# Use the existing models without downloading duplicates.
$env:OLLAMA_MODELS = 'D:\Ollama'
$env:OLLAMA_HOST = '127.0.0.1:11435'
$ollamaCommand = Get-Command ollama -ErrorAction Stop
try {
    $installed = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/api/tags' -TimeoutSec 3
    if ($installed.models.name -contains 'gemma4:e4b') { Write-Output 'Local Gemma is already running on port 11435.'; exit 0 }
    throw 'Port 11435 is occupied by an Ollama server without gemma4:e4b.'
} catch {
    if ($_.Exception.Message -like 'Port 11435*') { throw }
}
Start-Process -FilePath $ollamaCommand.Source -ArgumentList 'serve' -WindowStyle Hidden
Write-Output 'Started Ollama with D:\Ollama on port 11435. Run npm start for the IDE.'
