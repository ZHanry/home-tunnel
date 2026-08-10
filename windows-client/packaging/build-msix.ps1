[CmdletBinding()]
param(
    [string]$OutputDirectory = "",
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$clientRoot = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $clientRoot
$projectPath = Join-Path $clientRoot "HomeTunnel.Client.csproj"
$version = (Select-Xml -LiteralPath $projectPath -XPath "/Project/PropertyGroup/Version" | Select-Object -First 1).Node.InnerText
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid project version" }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "AppxManifest.xml")
if ($manifest -notmatch 'Version="([^"\r\n]+)"' -or $Matches[1] -ne "$version.0") { throw "MSIX manifest version does not match $version" }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $workspace "outputs\windows" }
$toolsRoot = Join-Path $workspace ".codex-tools"

$localPrograms = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "Programs"
$dotnetCandidates = @((Get-Command dotnet -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1))
if (Test-Path -LiteralPath $localPrograms -PathType Container) {
    $dotnetCandidates += Get-ChildItem -LiteralPath $localPrograms -Recurse -Filter dotnet.exe -File -ErrorAction SilentlyContinue |
        Where-Object FullName -Match '[\\/]dotnet-sdk[\\/]' |
        Select-Object -ExpandProperty FullName
}
$dotnet = $dotnetCandidates | Where-Object {
    $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) -and ((& $_ --list-sdks 2>$null) -match '^8\.')
} | Select-Object -First 1
if (-not $Python) { $Python = Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1 }
$windowsKitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$makeAppx = Get-ChildItem -LiteralPath $windowsKitsRoot -Recurse -Filter makeappx.exe -File -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '[\\/]x64[\\/]makeappx\.exe$' | Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName -First 1
$signTool = Get-ChildItem -LiteralPath $windowsKitsRoot -Recurse -Filter signtool.exe -File -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '[\\/]x64[\\/]signtool\.exe$' | Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName -First 1
foreach ($tool in @($dotnet, $Python, $makeAppx, $signTool)) { if (-not $tool -or -not (Test-Path -LiteralPath $tool)) { throw "Required build tool is missing: $tool" } }

$temporary = Join-Path $toolsRoot ("windows-package-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
$publish = Join-Path $temporary "publish"
$staging = Join-Path $temporary "staging"
$pfx = Join-Path $temporary "internal-test.pfx"
$pfxPasswordText = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
$pfxPassword = ConvertTo-SecureString $pfxPasswordText -AsPlainText -Force
$certificate = $null
try {
    New-Item -ItemType Directory -Force $publish, $staging, $OutputDirectory | Out-Null
    & $Python (Join-Path $PSScriptRoot "generate_assets.py")
    if ($LASTEXITCODE -ne 0) { throw "Asset generation failed" }
    & (Join-Path $clientRoot "build-agent.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Home Tunnel Agent build failed" }
    $agentHash = (Get-FileHash -LiteralPath (Join-Path $clientRoot "assets\HomeTunnel.Agent.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
    $agentHashNode = Select-Xml -LiteralPath $projectPath -XPath "/Project/PropertyGroup/AgentExpectedSha256" | Select-Object -First 1
    if ($agentHash -ne $agentHashNode.Node.InnerText.ToLowerInvariant()) { throw "Purpose-built Agent hash mismatch" }

    & $dotnet publish $projectPath -c Release -r win-x64 --self-contained true -o $publish --nologo `
        -p:AgentExpectedSha256=$agentHash
    if ($LASTEXITCODE -ne 0) { throw "Windows client publish failed" }
    Copy-Item -Path (Join-Path $publish "*") -Destination $staging -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "AppxManifest.xml") -Destination (Join-Path $staging "AppxManifest.xml")
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Assets") -Destination (Join-Path $staging "Assets") -Recurse
    Get-ChildItem -LiteralPath $staging -Recurse -Filter "*.pdb" | Remove-Item -Force

    $package = Join-Path $OutputDirectory "HomeTunnel-$version-x64.msix"
    $makeAppxLog = Join-Path $temporary "makeappx.log"
    & $makeAppx pack /d $staging /p $package /o *> $makeAppxLog
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $makeAppxLog -Tail 40
        throw "MSIX packing failed"
    }

    $certificate = New-SelfSignedCertificate -Type Custom -Subject "CN=Home Tunnel Internal Test" -FriendlyName "Home Tunnel $version Internal Test" -KeyUsage DigitalSignature -KeyExportPolicy Exportable -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(1) -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $pfxPassword | Out-Null
    $publicCertificate = Join-Path $OutputDirectory "HomeTunnel-Internal-Test.cer"
    Export-Certificate -Cert $certificate -FilePath $publicCertificate -Type CERT -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "CERTIFICATE.txt"), @"
Subject: $($certificate.Subject)
SHA1 Thumbprint: $($certificate.Thumbprint)
Not After: $($certificate.NotAfter.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
Purpose: Home Tunnel $version internal test code signing only
"@, [Text.UTF8Encoding]::new($false))
    & $signTool sign /fd SHA256 /f $pfx /p $pfxPasswordText $package
    if ($LASTEXITCODE -ne 0) { throw "MSIX signing failed" }
    $signature = Get-AuthenticodeSignature -FilePath $package
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or $signature.Status -in @("HashMismatch", "NotSigned")) {
        throw "MSIX signature verification failed: $($signature.Status)"
    }

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Install-HomeTunnel.ps1") -Destination (Join-Path $OutputDirectory "Install-HomeTunnel.ps1") -Force
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "README-安装.txt"), @"
Home Tunnel $version 内部测试安装包

1. 右键使用 PowerShell 运行 Install-HomeTunnel.ps1。
2. 安装脚本会把仅含代码签名用途的 HomeTunnel-Internal-Test.cer 导入当前用户 Root 存储，然后校验并安装 MSIX。
3. Windows 会弹出根证书安全确认；仅当提示名称为 Home Tunnel Internal Test 且指纹与 CERTIFICATE.txt 一致时确认。
4. 该证书仅用于内部测试，不是公开受信任的正式代码签名证书；卸载测试版后应移除该证书。
5. 首次启动时填写你的 Home Tunnel 控制中心 HTTPS 地址。
"@, [Text.UTF8Encoding]::new($true))
    $releaseArtifactNames = @(
        (Split-Path -Leaf $package),
        "HomeTunnel-Internal-Test.cer",
        "CERTIFICATE.txt",
        "Install-HomeTunnel.ps1",
        "README-安装.txt"
    )
    $hashLines = $releaseArtifactNames |
        ForEach-Object { Get-Item -LiteralPath (Join-Path $OutputDirectory $_) } |
        Sort-Object Name |
        ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
    [IO.File]::WriteAllLines((Join-Path $OutputDirectory "SHA256SUMS.txt"), $hashLines, [Text.UTF8Encoding]::new($false))
    Write-Output "MSIX=$package"
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
        $safeRoot = (Resolve-Path -LiteralPath $toolsRoot).Path + [IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing unsafe packaging cleanup" }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
