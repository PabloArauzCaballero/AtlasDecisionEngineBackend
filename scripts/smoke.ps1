param(
  [string]$BaseUrl = $(if ($env:BASE_URL) { $env:BASE_URL } else { "http://localhost:3000" }),
  [string]$RuntimeApiKey = $(if ($env:RUNTIME_API_KEY) { $env:RUNTIME_API_KEY } else { "change-me-runtime" }),
  [string]$ManagementApiKey = $(if ($env:MANAGEMENT_API_KEY) { $env:MANAGEMENT_API_KEY } else { "change-me-management" }),
  [string]$TenantId = $(if ($env:TENANT_ID) { $env:TENANT_ID } else { "1" })
)

$ErrorActionPreference = "Stop"
$env:BASE_URL = $BaseUrl
$env:RUNTIME_API_KEY = $RuntimeApiKey
$env:MANAGEMENT_API_KEY = $ManagementApiKey
$env:TENANT_ID = $TenantId

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir "smoke.mjs")
exit $LASTEXITCODE
