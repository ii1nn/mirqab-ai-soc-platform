<#
.SYNOPSIS
  Smoke-tests login through the Phase 8/9 Docker Compose stack's public
  entrypoint (https://localhost, the nginx reverse proxy) — confirms
  nginx -> backend -> Postgres actually works end-to-end, not just that
  each container reports healthy.

.DESCRIPTION
  Trusts the self-signed dev cert from
  infra/docker/nginx/certs/generate-self-signed-cert.sh for this process
  only (Windows PowerShell 5.1's Invoke-WebRequest has no -SkipCertificateCheck
  flag — that's PowerShell 7+ only). Credentials come from the
  MIRQAB_ADMIN_EMAIL / MIRQAB_ADMIN_PASSWORD environment variables, falling
  back to the seed defaults documented in infra/docker/.env.example only if
  those aren't set.
#>

add-type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@ -ErrorAction SilentlyContinue
[System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
$ProgressPreference = 'SilentlyContinue'

$email = if ($env:MIRQAB_ADMIN_EMAIL) { $env:MIRQAB_ADMIN_EMAIL } else { 'admin@mirqab.local' }
$password = if ($env:MIRQAB_ADMIN_PASSWORD) { $env:MIRQAB_ADMIN_PASSWORD } else { 'ChangeMe123!' }

$body = @{ email = $email; password = $password } | ConvertTo-Json

try {
    $resp = Invoke-WebRequest -Uri 'https://localhost/api/v1/auth/login' -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing
    Write-Output "Status: $($resp.StatusCode)"
    $json = $resp.Content | ConvertFrom-Json
    Write-Output "Has accessToken: $($null -ne $json.accessToken)"

    # /auth/login only returns tokens (see backend's AuthTokens interface) —
    # the user object (including role) comes from a separate /auth/me call,
    # same as the dashboard's own login flow (auth.store.ts) does.
    $meResp = Invoke-WebRequest -Uri 'https://localhost/api/v1/auth/me' -Method Get -Headers @{ Authorization = "Bearer $($json.accessToken)" } -UseBasicParsing
    $me = $meResp.Content | ConvertFrom-Json
    Write-Output "User role: $($me.role)"
} catch {
    Write-Output "FAILED: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Output $reader.ReadToEnd()
    }
    exit 1
}
