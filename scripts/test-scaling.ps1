<#
.SYNOPSIS
  Fires repeated requests at the public entrypoint (https://localhost) to
  prove nginx's dynamic `backend` resolution (infra/docker/nginx/nginx.conf)
  actually distributes traffic across multiple `backend` replicas, not just
  that it doesn't error with more than one running.

.DESCRIPTION
  Requires the stack already scaled up, e.g.:
    docker compose up -d --scale backend=3
  Trusts the self-signed dev cert for this process only (same reasoning as
  scripts/test-login.ps1). Reports how many requests succeeded; the actual
  proof of distribution is read separately from nginx's access log
  ($upstream_addr per request) via:
    docker compose logs nginx --tail 50

.PARAMETER Count
  How many requests to fire. Defaults to 15.
#>
param(
    [int]$Count = 15
)

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

$success = 0
$failed = 0

for ($i = 1; $i -le $Count; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri 'https://localhost/api/v1/auth/login' -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing
        if ($resp.StatusCode -eq 200) { $success++ } else { $failed++ }
    } catch {
        $failed++
        Write-Output "Request $i failed: $($_.Exception.Message)"
    }
}

Write-Output "Sent $Count requests: $success succeeded, $failed failed."
