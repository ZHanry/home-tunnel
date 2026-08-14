#ifndef MyAppVersion
  #define MyAppVersion "2.5.0"
#endif
#ifndef PublishDir
  #error PublishDir must be supplied by build-exe.ps1
#endif
#ifndef OutputDir
  #error OutputDir must be supplied by build-exe.ps1
#endif
#ifndef ClientRoot
  #error ClientRoot must be supplied by build-exe.ps1
#endif
#ifndef MyAppId
  #define MyAppId "{{4E68313F-935B-4BA6-A92E-70C42987EA4D}"
#endif
#ifndef MyCloseApplications
  #define MyCloseApplications "force"
#endif
#ifndef MyAppUrl
  #define MyAppUrl "https://github.com/ZHanry/home-tunnel"
#endif

#define MyAppName "Home Tunnel"
#define MyAppPublisher "Home Tunnel"
#define MyAppExeName "HomeTunnel.exe"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppUrl}
AppSupportURL={#MyAppUrl}
AppUpdatesURL={#MyAppUrl}
AppComments=安全发布本机 HTTP/HTTPS 服务的 Windows 客户端
DefaultDirName={localappdata}\Programs\Home Tunnel
DefaultGroupName=Home Tunnel
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableReadyPage=no
DisableFinishedPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=HomeTunnel-Setup-{#MyAppVersion}-x64
SetupIconFile={#ClientRoot}\assets\HomeTunnel.ico
WizardImageFile={#ClientRoot}\packaging\Assets\InstallerWizard.bmp
WizardSmallImageFile={#ClientRoot}\packaging\Assets\InstallerSmall.bmp
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications={#MyCloseApplications}
CloseApplicationsFilter=HomeTunnel.exe,HomeTunnel.Agent.exe,frpc.exe
RestartApplications=no
ShowLanguageDialog=no
UsePreviousLanguage=no
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Home Tunnel Windows 客户端安装程序
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "chinesesimplified"; MessagesFile: "{#ClientRoot}\packaging\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\frpc.exe"

[Icons]
Name: "{group}\Home Tunnel"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Home Tunnel"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 Home Tunnel"; Flags: nowait postinstall skipifsilent
