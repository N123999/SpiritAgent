$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent $PSScriptRoot
$projectDir = Join-Path $desktopDir "native/win-uia-helper"
$outDir = Join-Path $projectDir "bin/Release/net8.0-windows"

Push-Location $projectDir
try {
  dotnet publish -c Release -r win-x64 --self-contained false -o $outDir
  if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
  }
  Write-Host "Built spirit-win-uia.exe at $outDir"
}
finally {
  Pop-Location
}
