[CmdletBinding()]
param(
    [string]$OutputDirectory = "",
    [string]$InnoCompiler = "",
    [string]$Version = "",
    [string]$AppId = "",
    [string]$CloseApplications = "",
    [string]$WindRes = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$clientRoot = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $clientRoot
$projectUrl = "https://github.com/ZHanry/home-tunnel"
$projectPath = Join-Path $clientRoot "HomeTunnel.Client.csproj"
$versionNode = Select-Xml -LiteralPath $projectPath -XPath "/Project/PropertyGroup/Version" | Select-Object -First 1
$projectVersion = $versionNode.Node.InnerText
if (-not $Version) { $Version = $projectVersion }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must use MAJOR.MINOR.PATCH format" }
if ($Version -ne $projectVersion) { throw "Requested version $Version does not match project version $projectVersion" }
if ($AppId -and $AppId -notmatch '^\{\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') {
    throw "AppId must use Inno Setup escaped GUID format, for example {{00000000-0000-0000-0000-000000000000}"
}
if ($CloseApplications -and $CloseApplications -notin @("force", "no")) { throw "CloseApplications must be force or no" }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $workspace "outputs\windows" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$allowedOutputRoot = [IO.Path]::GetFullPath((Join-Path $workspace "outputs\windows"))
$allowedPrefix = $allowedOutputRoot + [IO.Path]::DirectorySeparatorChar
if ($OutputDirectory -ne $allowedOutputRoot -and -not $OutputDirectory.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Windows artifacts must be written below $allowedOutputRoot"
}

$dotnetCandidates = @(
    (Join-Path $workspace ".downloads\dotnet-sdk-10.0.400\dotnet.exe"),
    (Get-Command dotnet -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
)
$localPrograms = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "Programs"
if (Test-Path -LiteralPath $localPrograms -PathType Container) {
    $dotnetCandidates += Get-ChildItem -LiteralPath $localPrograms -Recurse -Filter dotnet.exe -File -ErrorAction SilentlyContinue |
        Where-Object FullName -Match '[\\/]dotnet-sdk[\\/]' |
        Select-Object -ExpandProperty FullName
}
$dotnet = $dotnetCandidates | Where-Object {
    if (-not $_ -or -not (Test-Path -LiteralPath $_ -PathType Leaf)) { return $false }
    try { (& $_ --list-sdks 2>$null) -match '^10\.0\.400\b' } catch { $false }
} | Select-Object -First 1
$windowsKitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$signTool = Get-ChildItem -LiteralPath $windowsKitsRoot -Recurse -Filter signtool.exe -File -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '[\\/]x64[\\/]signtool\.exe$' |
    Sort-Object FullName -Descending |
    Select-Object -ExpandProperty FullName -First 1
if (-not $InnoCompiler) {
    $innoCandidates = @(
        (Join-Path $localPrograms "Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
    ) | Where-Object { $_ }
    $InnoCompiler = $innoCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
foreach ($tool in @($dotnet, $signTool, $InnoCompiler)) {
    if (-not $tool -or -not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required build tool is missing: $tool" }
}

$toolsRoot = Join-Path $workspace ".codex-tools"
$temporary = Join-Path $toolsRoot ("windows-exe-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
$publish = Join-Path $temporary "publish"
$signedAgent = Join-Path $temporary "HomeTunnel.Agent.exe"
$pfx = Join-Path $temporary "internal-release.pfx"
$pfxPasswordText = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
$pfxPassword = ConvertTo-SecureString $pfxPasswordText -AsPlainText -Force
$certificate = $null
$buildStarted = Get-Date

try {
    New-Item -ItemType Directory -Force $publish, $OutputDirectory | Out-Null
    $certificate = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=Home Tunnel Internal Release" `
        -FriendlyName "Home Tunnel $Version Internal Release" `
        -KeyExportPolicy Exportable `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(2)
    Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $pfxPassword | Out-Null

    & (Join-Path $clientRoot "build-agent.ps1") -WindRes $WindRes
    if ($LASTEXITCODE -ne 0) { throw "Home Tunnel Agent build failed" }
    $unsignedAgent = Join-Path $clientRoot "assets\HomeTunnel.Agent.exe"
    $agentHashNode = Select-Xml -LiteralPath $projectPath -XPath "/Project/PropertyGroup/AgentExpectedSha256" | Select-Object -First 1
    $expectedUnsignedAgentHash = $agentHashNode.Node.InnerText.ToLowerInvariant()
    $unsignedAgentHash = (Get-FileHash -LiteralPath $unsignedAgent -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($unsignedAgentHash -ne $expectedUnsignedAgentHash) {
        throw "Purpose-built Agent hash does not match the reviewed project baseline"
    }
    Copy-Item -LiteralPath $unsignedAgent -Destination $signedAgent
    & $signTool sign /fd SHA256 /f $pfx /p $pfxPasswordText /d "Home Tunnel Managed Network Agent" $signedAgent
    if ($LASTEXITCODE -ne 0) { throw "Home Tunnel Agent signing failed" }
    $signedAgentHash = (Get-FileHash -LiteralPath $signedAgent -Algorithm SHA256).Hash.ToLowerInvariant()

    $publishArguments = @(
        "publish",
        $projectPath,
        "-c", "Release",
        "-r", "win-x64",
        "--self-contained", "true",
        "-o", $publish,
        "--nologo",
        "-p:AgentBinaryPath=$signedAgent",
        "-p:AgentExpectedSha256=$signedAgentHash",
        "-p:AgentSignerThumbprint=$($certificate.Thumbprint.ToLowerInvariant())"
    )
    & $dotnet @publishArguments
    if ($LASTEXITCODE -ne 0) { throw "Windows client publish failed" }
    Get-ChildItem -LiteralPath $publish -Recurse -Filter "*.pdb" | Remove-Item -Force

    $publishedAgent = Join-Path $publish "HomeTunnel.Agent.exe"
    if (-not (Test-Path -LiteralPath $publishedAgent -PathType Leaf)) { throw "Published Home Tunnel Agent is missing" }
    $publishedAgentHash = (Get-FileHash -LiteralPath $publishedAgent -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($publishedAgentHash -ne $signedAgentHash) { throw "Published Home Tunnel Agent hash mismatch" }

    $clientExecutable = Join-Path $publish "HomeTunnel.exe"
    & $signTool sign /fd SHA256 /f $pfx /p $pfxPasswordText /d "Home Tunnel Windows Client" $clientExecutable
    if ($LASTEXITCODE -ne 0) { throw "Windows client signing failed" }

    $installerScript = Join-Path $PSScriptRoot "HomeTunnel.iss"
    $innoArguments = @(
        "/Qp",
        "/DMyAppVersion=$Version",
        "/DPublishDir=$publish",
        "/DOutputDir=$OutputDirectory",
        "/DClientRoot=$clientRoot",
        "/DMyAppUrl=$projectUrl",
        $installerScript
    )
    if ($AppId) { $innoArguments = @("/DMyAppId=$AppId") + $innoArguments }
    if ($CloseApplications) { $innoArguments = @("/DMyCloseApplications=$CloseApplications") + $innoArguments }
    & $InnoCompiler @innoArguments
    if ($LASTEXITCODE -ne 0) { throw "EXE installer compilation failed" }

    $installer = Join-Path $OutputDirectory "HomeTunnel-Setup-$Version-x64.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "EXE installer output is missing" }
    & $signTool sign /fd SHA256 /f $pfx /p $pfxPasswordText /d "Home Tunnel $Version Installer" $installer
    if ($LASTEXITCODE -ne 0) { throw "EXE installer signing failed" }

    $header = [IO.File]::ReadAllBytes($installer)[0..1]
    if ($header[0] -ne 0x4d -or $header[1] -ne 0x5a) { throw "Installer is not a valid Windows executable" }
    foreach ($signedFile in @($publishedAgent, $clientExecutable, $installer)) {
        $signature = Get-AuthenticodeSignature -FilePath $signedFile
        if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or $signature.Status -in @("HashMismatch", "NotSigned")) {
            throw "Authenticode signature verification failed for ${signedFile}: $($signature.Status)"
        }
    }

    if ((Get-Command Start-MpScan -ErrorAction SilentlyContinue) -and (Get-MpComputerStatus).AntivirusEnabled) {
        foreach ($scanFile in @($signedAgent, $installer)) {
            Start-MpScan -ScanType CustomScan -ScanPath $scanFile
            if (-not (Test-Path -LiteralPath $scanFile -PathType Leaf)) {
                throw "Microsoft Defender removed release artifact: $scanFile"
            }
            Get-FileHash -LiteralPath $scanFile -Algorithm SHA256 -ErrorAction Stop | Out-Null
            $detection = Get-MpThreatDetection |
                Where-Object {
                    $_.InitialDetectionTime -ge $buildStarted -and
                    ($_.Resources -join "|") -like "*$scanFile*"
                } |
                Select-Object -First 1
            if ($detection) { throw "Microsoft Defender detected release artifact: $scanFile (ThreatID $($detection.ThreatID))" }
        }
    }

    $publicCertificate = Join-Path $OutputDirectory "HomeTunnel-Internal-Code-Signing.cer"
    Export-Certificate -Cert $certificate -FilePath $publicCertificate -Type CERT -Force | Out-Null
    $installerInfo = Get-Item -LiteralPath $installer
    $installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    $releasedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $metadata = [ordered]@{
        version = $Version
        platform = "windows"
        architecture = "x64"
        file_name = $installerInfo.Name
        size_bytes = $installerInfo.Length
        sha256 = $installerHash
        released_at = $releasedAt
        download_url = "$projectUrl/releases/download/v$Version/$($installerInfo.Name)"
        stable_download_url = "$projectUrl/releases/latest"
        release_channel = "experimental"
        signature = "internal-self-signed"
        signature_trust = "untrusted-self-signed"
        certificate_thumbprint = $certificate.Thumbprint.ToLowerInvariant()
    }
    [IO.File]::WriteAllText(
        (Join-Path $OutputDirectory "latest.json"),
        ($metadata | ConvertTo-Json -Depth 3) + "`n",
        [Text.UTF8Encoding]::new($false)
    )
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "SIGNATURE.txt"), @"
Subject: $($certificate.Subject)
SHA1 Thumbprint: $($certificate.Thumbprint)
Not After: $($certificate.NotAfter.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
Purpose: Home Tunnel $Version internal Authenticode signing
Trust: Internal self-signed certificate; a publicly trusted code-signing certificate is required for production publisher trust.
Agent SHA-256: $signedAgentHash
Agent: Purpose-built Home Tunnel Agent $Version based on pinned FRP 0.70.1 source.
"@, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "README-EXE.txt"), @"
Home Tunnel $Version Windows x64 安装包

1. 双击 HomeTunnel-Setup-$Version-x64.exe，按向导完成安装。
2. 当前版本使用内部自签名证书进行完整性签名；Windows 可能显示未知发布者或 SmartScreen 提示。
3. 安装后填写你的 Home Tunnel 控制中心 HTTPS 地址，再使用管理员分配的普通用户账号登录。
4. 项目与下载：$projectUrl

SHA-256: $installerHash
"@, [Text.UTF8Encoding]::new($true))

    $releaseArtifactNames = @(
        $installerInfo.Name,
        "HomeTunnel-Internal-Code-Signing.cer",
        "latest.json",
        "README-EXE.txt",
        "SIGNATURE.txt"
    )
    $hashLines = $releaseArtifactNames |
        ForEach-Object { Get-Item -LiteralPath (Join-Path $OutputDirectory $_) } |
        Sort-Object Name |
        ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
    [IO.File]::WriteAllLines((Join-Path $OutputDirectory "SHA256SUMS.txt"), $hashLines, [Text.UTF8Encoding]::new($false))

    Write-Output "EXE=$installer"
    Write-Output "EXE_SHA256=$installerHash"
    Write-Output "EXE_SIZE=$($installerInfo.Length)"
    Write-Output "AGENT_SHA256=$signedAgentHash"
    Write-Output "CERT_THUMBPRINT=$($certificate.Thumbprint)"
}
finally {
    if ($certificate) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $pfx) {
        $length = (Get-Item -LiteralPath $pfx).Length
        [IO.File]::WriteAllBytes($pfx, [byte[]]::new($length))
    }
    if (Test-Path -LiteralPath $temporary) {
        $resolved = (Resolve-Path -LiteralPath $temporary).Path
        $safeRoot = [IO.Path]::GetFullPath($toolsRoot) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing unsafe packaging cleanup" }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
