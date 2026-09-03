#define AppName "Home Tunnel"
#ifndef AppVersion
  #define AppVersion "4.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "."
#endif

[Setup]
AppId={{8F3C1B2A-7D54-4E19-9A6C-2B0E5D8F4A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Home Tunnel
DefaultDirName={localappdata}\Home Tunnel
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir={#SourceDir}
OutputBaseFilename=HomeTunnel-Setup-{#AppVersion}-x64
SetupIconFile={#SourceDir}\HomeTunnel.ico
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\home-tunnel-gui.exe
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#SourceDir}\home-tunnel-gui.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\home-tunnel-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\HomeTunnel.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Home Tunnel"; Filename: "{app}\home-tunnel-gui.exe"; IconFilename: "{app}\HomeTunnel.ico"
Name: "{group}\Uninstall Home Tunnel"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Home Tunnel"; Filename: "{app}\home-tunnel-gui.exe"; IconFilename: "{app}\HomeTunnel.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\home-tunnel-gui.exe"; Description: "Launch Home Tunnel"; Flags: nowait postinstall skipifsilent
