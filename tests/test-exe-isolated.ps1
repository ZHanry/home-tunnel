[CmdletBinding()]
param(
    [string[]]$ForbiddenText = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$windowsOutput = [IO.Path]::GetFullPath((Join-Path $workspace "outputs\windows"))
$testOutput = Join-Path $windowsOutput ("isolated-test-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
$project = Join-Path $workspace "windows-client\HomeTunnel.Client.csproj"
$version = (Select-Xml -LiteralPath $project -XPath "/Project/PropertyGroup/Version" | Select-Object -First 1).Node.InnerText
$appId = "{{" + [Guid]::NewGuid().ToString().ToUpperInvariant() + "}"

try {
    & (Join-Path $workspace "windows-client\packaging\build-exe.ps1") `
        -OutputDirectory $testOutput `
        -Version $version `
        -AppId $appId `
        -CloseApplications no
    if ($LASTEXITCODE -ne 0) { throw "Isolated installer build failed" }

    $installer = Join-Path $testOutput "HomeTunnel-Setup-$version-x64.exe"
    & (Join-Path $workspace "windows-client\packaging\test-exe.ps1") `
        -Installer $installer `
        -IsolatedPackage `
        -ForbiddenText $ForbiddenText
    if ($LASTEXITCODE -ne 0) { throw "Isolated installer test failed" }
}
finally {
    if (Test-Path -LiteralPath $testOutput) {
        $resolved = (Resolve-Path -LiteralPath $testOutput).Path
        $safePrefix = $windowsOutput + [IO.Path]::DirectorySeparatorChar + "isolated-test-"
        if (-not $resolved.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe isolated installer cleanup"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
