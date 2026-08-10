$ErrorActionPreference = "Stop"
$output = (Resolve-Path (Join-Path $PSScriptRoot "..\outputs\windows")).Path
$project = Join-Path $PSScriptRoot "..\windows-client\HomeTunnel.Client.csproj"
$version = (Select-Xml -LiteralPath $project -XPath "/Project/PropertyGroup/Version" | Select-Object -First 1).Node.InnerText
$certificatePath = Join-Path $output "HomeTunnel-Internal-Test.cer"
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
$preexisting = Get-AppxPackage -Name "HomeTunnel.Client" -ErrorAction SilentlyContinue
if ($preexisting) { throw "A pre-existing HomeTunnel.Client package was found; refusing to alter it" }
$installed = $null
try {
    & (Join-Path $output "Install-HomeTunnel.ps1")
    $installed = Get-AppxPackage -Name "HomeTunnel.Client" -ErrorAction Stop
    if ($installed.Version.ToString() -ne "$version.0") { throw "Unexpected installed version $($installed.Version)" }
    Write-Output "MSIX install verified: $($installed.PackageFullName)"
}
finally {
    if ($installed) { Remove-AppxPackage -Package $installed.PackageFullName }
    $trustedPath = "Cert:\CurrentUser\Root\$($certificate.Thumbprint)"
    if (Test-Path -LiteralPath $trustedPath) { Remove-Item -LiteralPath $trustedPath -Force }
}
if (Get-AppxPackage -Name "HomeTunnel.Client" -ErrorAction SilentlyContinue) { throw "MSIX test package cleanup failed" }
Write-Output "MSIX test package and temporary trust entry removed."
