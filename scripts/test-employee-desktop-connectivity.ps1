<#
.SYNOPSIS
  Confirms apps/employee-desktop can reach the Dockerized backend directly
  (plain HTTP, no nginx/TLS) the way its default VITE_API_BASE_URL expects —
  see docs/phases/phase-12.md.

.DESCRIPTION
  The backend's container port 3000 is published to a random host port (not
  a fixed one — see infra/docker/docker-compose.yml's comment on why) so it
  coexists with `docker compose up --scale backend=N`. This script resolves
  that port via `docker compose port backend 3000`, then sends a login
  request with an `Origin: http://localhost:5174` header — matching
  employee-desktop's Vite dev server (vite.config.ts) — to confirm the
  backend's CORS_ORIGIN actually allows it, not just that the port is open.

.PARAMETER ComposeDir
  Path to the infra/docker folder. Defaults to ../infra/docker relative to
  this script.
#>
param(
    [string]$ComposeDir = (Join-Path $PSScriptRoot '..\infra\docker')
)

$ProgressPreference = 'SilentlyContinue'

Push-Location $ComposeDir
try {
    $portMapping = docker compose port backend 3000
    if (-not $portMapping) {
        Write-Output "FAILED: could not resolve the backend published port. Is the stack up? (docker compose ps)"
        exit 1
    }
    $hostPort = ($portMapping -split ':')[-1]
} finally {
    Pop-Location
}

Write-Output "Backend published at host port $hostPort"

$email = if ($env:MIRQAB_ADMIN_EMAIL) { $env:MIRQAB_ADMIN_EMAIL } else { 'admin@mirqab.local' }
$password = if ($env:MIRQAB_ADMIN_PASSWORD) { $env:MIRQAB_ADMIN_PASSWORD } else { 'ChangeMe123!' }
$body = @{ email = $email; password = $password } | ConvertTo-Json

try {
    $requestParams = @{
        Uri             = "http://localhost:$hostPort/api/v1/auth/login"
        Method          = 'Post'
        Body            = $body
        ContentType     = 'application/json'
        Headers         = @{ Origin = 'http://localhost:5174' }
        UseBasicParsing = $true
    }
    $resp = Invoke-WebRequest @requestParams
    Write-Output "Status: $($resp.StatusCode)"
    $corsHeader = $resp.Headers['Access-Control-Allow-Origin']
    Write-Output "Access-Control-Allow-Origin: $corsHeader"
    $json = $resp.Content | ConvertFrom-Json
    Write-Output "Has accessToken: $($null -ne $json.accessToken)"
} catch {
    Write-Output "FAILED: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Output $reader.ReadToEnd()
    }
    exit 1
}
