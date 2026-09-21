[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = "Stop"
$mcRoot = Join-Path $env:APPDATA ".minecraft"
$modsDir = Join-Path $mcRoot "mods"
$profileDir = Join-Path $mcRoot "versions\fabric-loader-0.19.3-1.21.11"
$sourceMods = Join-Path $PSScriptRoot "mods"
$legacyNames = @(
    "fabric-api-0.116.17+1.21.1.jar",
    "voicechat-fabric-1.21.1-2.6.21.jar"
)
$newNames = @(
    "fabric-api-0.141.6+1.21.11.jar",
    "scamcity-bridge-0.1.0.jar"
)

if (-not (Test-Path -LiteralPath $profileDir)) {
    throw "Expected Fabric profile was not found: $profileDir"
}
if (-not (Test-Path -LiteralPath $modsDir)) {
    throw "Minecraft mods directory was not found: $modsDir"
}
if (Get-Process -Name java,javaw,minecraftlauncher -ErrorAction SilentlyContinue) {
    throw "Minecraft or the launcher is still running. Close it and rerun this script."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $mcRoot "scamcity-backups\$stamp"
$moved = [System.Collections.Generic.List[string]]::new()
$created = [System.Collections.Generic.List[string]]::new()

try {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    foreach ($name in $legacyNames) {
        $path = Join-Path $modsDir $name
        if (Test-Path -LiteralPath $path) {
            $target = Join-Path $backupDir $name
            if ($PSCmdlet.ShouldProcess($path, "Move to $target")) {
                Move-Item -LiteralPath $path -Destination $target
                $moved.Add($name)
            }
        }
    }

    foreach ($name in $newNames) {
        $source = Join-Path $sourceMods $name
        $target = Join-Path $modsDir $name
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Staged mod is missing: $source"
        }

        if (Test-Path -LiteralPath $target) {
            $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
            $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
            if ($sourceHash -eq $targetHash) {
                continue
            }
            $conflict = Join-Path $backupDir ("existing-" + $name)
            if ($PSCmdlet.ShouldProcess($target, "Move conflicting file to $conflict")) {
                Move-Item -LiteralPath $target -Destination $conflict
                $moved.Add($target)
            }
        }

        if ($PSCmdlet.ShouldProcess($target, "Copy staged mod")) {
            Copy-Item -LiteralPath $source -Destination $target
            $created.Add($target)
        }
    }

    Write-Output "ScamCity bridge installed for Fabric 1.21.11."
    Write-Output "Backup directory: $backupDir"
    Write-Output ("Installed: " + ($newNames -join ", "))
    if ($moved.Count -gt 0) {
        Write-Output ("Backed up: " + ($moved -join ", "))
    }
}
catch {
    foreach ($path in $created) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }
    foreach ($name in $moved) {
        $source = Join-Path $backupDir $name
        $target = if ([IO.Path]::IsPathRooted($name)) { $name } else { Join-Path $modsDir $name }
        if ((Test-Path -LiteralPath $source) -and -not (Test-Path -LiteralPath $target)) {
            Move-Item -LiteralPath $source -Destination $target
        }
    }
    throw
}
