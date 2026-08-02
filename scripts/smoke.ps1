param(
  [string]$BaseUrl,
  [string]$RuntimeApiKey,
  [string]$ManagementApiKey,
  [string]$TenantId
)

# Thin wrapper: every setting comes from .env (loaded by smoke.mjs) or from the environment.
# Only an explicitly passed parameter overrides them, so the smoke can never authenticate with
# a credential that lives in this file instead of in configuration.
$ErrorActionPreference = "Stop"
if ($BaseUrl) { $env:BASE_URL = $BaseUrl }
if ($RuntimeApiKey) { $env:RUNTIME_API_KEY = $RuntimeApiKey }
if ($ManagementApiKey) { $env:MANAGEMENT_API_KEY = $ManagementApiKey }
if ($TenantId) { $env:TENANT_ID = $TenantId }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir "smoke.mjs")
exit $LASTEXITCODE
