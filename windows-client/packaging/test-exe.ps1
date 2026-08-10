[CmdletBinding()]
param(
    [string]$Installer = "",
    [switch]$IsolatedPackage,
    [string[]]$ForbiddenText = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$clientRoot = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $clientRoot
$projectPath = Join-Path $clientRoot "HomeTunnel.Client.csproj"
$version = (Select-Xml -LiteralPath $projectPath -XPath "/Project/PropertyGroup/Version" | Select-Object -First 1).Node.InnerText
if (-not $Installer) { $Installer = Join-Path $workspace "outputs\windows\HomeTunnel-Setup-$version-x64.exe" }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$windowsOutputRoot = [IO.Path]::GetFullPath((Join-Path $workspace "outputs\windows"))
if ($IsolatedPackage) {
    $isolatedPrefix = $windowsOutputRoot + [IO.Path]::DirectorySeparatorChar + "isolated-test-"
    if (-not $Installer.StartsWith($isolatedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Isolated installer tests must use an isolated-test-* output directory"
    }
}
$toolsRoot = Join-Path $workspace ".codex-tools"
New-Item -ItemType Directory -Force $toolsRoot | Out-Null
$toolsRoot = (Resolve-Path -LiteralPath $toolsRoot).Path
$installedClientRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs\Home Tunnel"))
$activeInstalledProcesses = Get-Process -Name HomeTunnel, HomeTunnel.Agent, frpc -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith(
            $installedClientRoot + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)
    }
if ($activeInstalledProcesses -and -not $IsolatedPackage) {
    $processList = ($activeInstalledProcesses | ForEach-Object { "$($_.ProcessName) ($($_.Id))" }) -join ", "
    throw "Refusing isolated installer test while the installed client is running: $processList"
}
$testRoot = Join-Path $toolsRoot ("installer-test-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$installRoot = Join-Path $testRoot "app"

try {
    $installProcess = Start-Process -FilePath $Installer -ArgumentList @(
        "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/NOICONS", "/DIR=`"$installRoot`"", "/LOG=`"$testRoot\install.log`""
    ) -Wait -PassThru -WindowStyle Hidden
    if ($installProcess.ExitCode -ne 0) {
        $installLog = Join-Path $testRoot "install.log"
        if (Test-Path -LiteralPath $installLog) { Get-Content -LiteralPath $installLog -Tail 40 | Write-Warning }
        throw "Installer exit code $($installProcess.ExitCode)"
    }

    $app = Join-Path $installRoot "HomeTunnel.exe"
    $agent = Join-Path $installRoot "HomeTunnel.Agent.exe"
    $uninstaller = Join-Path $installRoot "unins000.exe"
    foreach ($file in @($app, $agent, $uninstaller)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Installed payload is missing: $file" }
    }
    if (Test-Path -LiteralPath (Join-Path $installRoot "frpc.exe")) { throw "Obsolete frpc.exe must not remain installed" }
    if (Get-ChildItem -LiteralPath $installRoot -Recurse -File | Where-Object {
        $_.Extension -in @(".pfx", ".p12", ".key", ".pem") -or $_.Name -match 'credential|password|secret'
    } | Select-Object -First 1) {
        throw "Installed payload contains a credential-like file"
    }
    $packagedForbiddenFragments = @(
        "BEGIN PRIVATE KEY",
        "BEGIN OPENSSH PRIVATE KEY"
    ) + @($ForbiddenText | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $localBuildFragments = @(
        $workspace,
        [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile),
        [Environment]::UserName
    )
    foreach ($payloadFile in Get-ChildItem -LiteralPath $installRoot -Recurse -File) {
        $payloadBytes = [IO.File]::ReadAllBytes($payloadFile.FullName)
        $payloadViews = @(
            [Text.Encoding]::Latin1.GetString($payloadBytes),
            [Text.Encoding]::Unicode.GetString($payloadBytes),
            [Text.Encoding]::BigEndianUnicode.GetString($payloadBytes)
        )
        $forbiddenFragments = $packagedForbiddenFragments
        if ($payloadFile.Name -ne "unins000.dat") {
            $forbiddenFragments += $localBuildFragments
        }
        foreach ($fragment in $forbiddenFragments) {
            if ($payloadViews.Where({ $_.IndexOf($fragment, [StringComparison]::OrdinalIgnoreCase) -ge 0 }, "First").Count) {
                throw "Installed payload contains forbidden local or deployment text in $($payloadFile.Name)"
            }
        }
    }
    $agentHash = (Get-FileHash -LiteralPath $agent -Algorithm SHA256).Hash.ToLowerInvariant()
    $installedVersion = (Get-Item -LiteralPath $app).VersionInfo.ProductVersion
    if (-not $installedVersion.StartsWith($version, [StringComparison]::Ordinal)) {
        throw "Installed client version $installedVersion does not match expected version $version"
    }
    $agentStart = [Diagnostics.ProcessStartInfo]::new($agent)
    $agentStart.UseShellExecute = $false
    $agentStart.CreateNoWindow = $true
    $agentStart.RedirectStandardOutput = $true
    $agentStart.RedirectStandardError = $true
    $agentStart.ArgumentList.Add("version")
    $agentProcess = [Diagnostics.Process]::new()
    $agentProcess.StartInfo = $agentStart
    if (-not $agentProcess.Start()) { throw "Installed Agent did not start" }
    $agentVersion = $agentProcess.StandardOutput.ReadToEnd().Trim()
    $agentError = $agentProcess.StandardError.ReadToEnd().Trim()
    $agentProcess.WaitForExit()
    $agentExitCode = $agentProcess.ExitCode
    $agentProcess.Dispose()
    if ($agentExitCode -ne 0 -or $agentVersion -notlike "Home Tunnel Agent $version*") {
        throw "Installed Agent version self-check failed: $agentVersion $agentError"
    }
    $appSignature = Get-AuthenticodeSignature -FilePath $app
    $agentSignature = Get-AuthenticodeSignature -FilePath $agent
    if (-not $appSignature.SignerCertificate -or -not $agentSignature.SignerCertificate -or
        $appSignature.SignerCertificate.Thumbprint -ne $agentSignature.SignerCertificate.Thumbprint -or
        $agentSignature.Status -in @("HashMismatch", "NotSigned")) {
        throw "Installed Agent signature does not match the client"
    }
    $fileCount = (Get-ChildItem -LiteralPath $installRoot -Recurse -File).Count

    $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @(
        "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"
    ) -Wait -PassThru -WindowStyle Hidden
    if ($uninstallProcess.ExitCode -ne 0) { throw "Uninstaller exit code $($uninstallProcess.ExitCode)" }
    for ($attempt = 0; $attempt -lt 30 -and (Test-Path -LiteralPath $installRoot); $attempt++) {
        Start-Sleep -Milliseconds 200
    }
    [pscustomobject]@{
        Install = "passed"
        ProductVersion = $installedVersion
        AgentVersion = $agentVersion
        FileCount = $fileCount
        AgentSha256 = $agentHash
        Uninstalled = -not (Test-Path -LiteralPath $installRoot)
    }
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolved = (Resolve-Path -LiteralPath $testRoot).Path
        $safePrefix = $toolsRoot + [IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe installer test cleanup"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
