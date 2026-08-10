param(
    [Parameter(Mandatory = $true)][string]$TemporaryDirectory,
    [Parameter(Mandatory = $true)][string]$Thumbprint
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$safeRoot = (Resolve-Path (Join-Path $workspace ".codex-tools")).Path + [IO.Path]::DirectorySeparatorChar
$resolved = (Resolve-Path -LiteralPath $TemporaryDirectory).Path
if (-not $resolved.StartsWith($safeRoot + "windows-package-", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe packaging cleanup path"
}
if ($Thumbprint -notmatch "^[0-9A-F]{40}$") { throw "Invalid certificate thumbprint" }

$pfx = Join-Path $resolved "internal-test.pfx"
if (Test-Path -LiteralPath $pfx) {
    $length = [int](Get-Item -LiteralPath $pfx).Length
    [IO.File]::WriteAllBytes($pfx, [byte[]]::new($length))
}
foreach ($store in @("My", "Root", "TrustedPeople")) {
    $certificatePath = "Cert:\CurrentUser\$store\$Thumbprint"
    if (Test-Path -LiteralPath $certificatePath) { Remove-Item -LiteralPath $certificatePath -Force }
}
Remove-Item -LiteralPath $resolved -Recurse -Force
Write-Output "Packaging private-key temporary state removed."
