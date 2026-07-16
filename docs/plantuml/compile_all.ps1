param(
  [Parameter(Mandatory=$false)][string]$PlantUmlJar = "plantuml.jar",
  [ValidateSet("svg", "png", "pdf")][string]$Format = "svg"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Output = Join-Path $Root "rendered"
New-Item -ItemType Directory -Force -Path $Output | Out-Null

if (-not (Test-Path $PlantUmlJar)) {
  throw "No se encontró plantuml.jar en: $PlantUmlJar"
}

$Files = Get-ChildItem -Path $Root -Filter "*.puml" | Sort-Object Name
if ($Files.Count -eq 0) { throw "No se encontraron archivos .puml" }

foreach ($File in $Files) {
  Write-Host "[ATLAS] Compilando $($File.Name)..."
  & java -jar $PlantUmlJar "-t$Format" -charset UTF-8 -o $Output $File.FullName
  if ($LASTEXITCODE -ne 0) { throw "Falló la compilación de $($File.Name)" }
}

Write-Host "OK: $($Files.Count) diagramas compilados en $Output"
