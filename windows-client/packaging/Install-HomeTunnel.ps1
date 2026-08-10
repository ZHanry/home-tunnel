$ErrorActionPreference = "Stop"
$packages = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "HomeTunnel-*-x64.msix" -File)
if ($packages.Count -ne 1 -or $packages[0].Name -notmatch '^HomeTunnel-(\d+\.\d+\.\d+)-x64\.msix$') {
    throw "应当且只能存在一个符合版本命名规范的 Home Tunnel MSIX。"
}
$package = $packages[0].FullName
$version = $Matches[1]
$certificate = Join-Path $PSScriptRoot "HomeTunnel-Internal-Test.cer"
if (-not (Test-Path -LiteralPath $package) -or -not (Test-Path -LiteralPath $certificate)) {
    throw "安装包或测试证书缺失。"
}
$expected = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate)
Write-Warning "即将把仅含代码签名用途的 Home Tunnel 内部测试证书导入当前用户 Root 存储；正式版必须改用公开受信证书。"
Write-Host "证书 SHA-1 指纹：$($expected.Thumbprint)"
$store = [Security.Cryptography.X509Certificates.X509Store]::new("Root", [Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($expected)
}
finally {
    $store.Close()
}
if (-not (Test-Path -LiteralPath "Cert:\CurrentUser\Root\$($expected.Thumbprint)")) { throw "测试根证书导入失败。" }
$signature = Get-AuthenticodeSignature -FilePath $package
if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $expected.Thumbprint -or $signature.Status -in @("HashMismatch", "NotSigned")) {
    throw "MSIX 签名或签名证书不匹配：$($signature.Status)"
}
Add-AppxPackage -Path $package
Write-Host "Home Tunnel $version 已安装。正式发布前应改用受信任的代码签名证书。"
