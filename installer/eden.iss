; EDEN Smart Estate: Windows installer (Inno Setup 6). Built by scripts\build-installer.ps1, which defines:
;   Version   the release number            Stage   the staged app folder (with its own Python)       OutDir   where the .exe goes
; The installer needs no administrator rights (it installs for the current user) and no Python on the PC: it brings its own.
; It installs into the same places as the older zip/PowerShell setup (%LOCALAPPDATA%\EDEN, with "app" and "data"), so it updates
; such an installation in place and your data is never touched.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Stage
  #error Stage must be defined (path of the staged app)
#endif
#ifndef OutDir
  #define OutDir "..\release"
#endif

[Setup]
AppId={{6E1D0C58-3B7A-4F0E-9A52-ED3E25A7E001}
AppName=EDEN Smart Estate
AppVersion={#Version}
AppVerName=EDEN Smart Estate {#Version}
AppPublisher=unupunct
AppPublisherURL=https://github.com/unupunct/Eden-Smart-Estate
AppSupportURL=https://github.com/unupunct/Eden-Smart-Estate/issues
AppUpdatesURL=https://github.com/unupunct/Eden-Smart-Estate/releases
VersionInfoVersion={#Version}
VersionInfoDescription=EDEN Smart Estate setup
DefaultDirName={localappdata}\EDEN
DefaultGroupName=EDEN Smart Estate
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
LicenseFile=..\LICENSE
SetupIconFile=eden.ico
UninstallDisplayIcon={app}\eden.ico
OutputDir={#OutDir}
OutputBaseFilename=EdenSmartEstate-Setup-{#Version}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
#ifdef Sign
SignTool=edensign
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; Flags: unchecked
Name: "autostart"; Description: "Start EDEN when I sign in to Windows (without opening the browser)"; Flags: unchecked
Name: "ocr"; Description: "Install the OCR engine Tesseract to read text in photos and scans (about 50 MB, downloaded with winget; Windows will ask for permission)"; Flags: unchecked

[Dirs]
Name: "{app}\data"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "EDEN.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "eden.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\stop-eden.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\EDEN Smart Estate\EDEN Smart Estate"; Filename: "{app}\EDEN.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\eden.ico"; Comment: "Start EDEN Smart Estate"
Name: "{autoprograms}\EDEN Smart Estate\EDEN data folder"; Filename: "{win}\explorer.exe"; Parameters: """{app}\data"""; Comment: "Your estate data and backups"
Name: "{autoprograms}\EDEN Smart Estate\EDEN user guide"; Filename: "{app}\app\docs\USER_GUIDE.md"
Name: "{autodesktop}\EDEN Smart Estate"; Filename: "{app}\EDEN.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\eden.ico"; Tasks: desktopicon
Name: "{userstartup}\EDEN Smart Estate"; Filename: "{app}\EDEN.cmd"; Parameters: "-NoBrowser"; WorkingDir: "{app}"; IconFilename: "{app}\eden.ico"; Tasks: autostart

[InstallDelete]
; leftovers of the older PowerShell setup (its own Python environment and uninstaller)
Type: filesandordirs; Name: "{app}\app\backend\.venv"
Type: files; Name: "{app}\Uninstall-EDEN.ps1"
Type: filesandordirs; Name: "{app}\app\python"

[Registry]
; the older setup's "Installed apps" entry: this installer has its own
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\EDENSmartEstate"; Flags: deletekey

[Run]
Filename: "winget"; Parameters: "install -e --id UB-Mannheim.TesseractOCR --silent --accept-package-agreements --accept-source-agreements"; StatusMsg: "Installing the OCR engine (Tesseract)..."; Tasks: ocr; Check: HasWinget; Flags: runhidden waituntilterminated
Filename: "{app}\EDEN.cmd"; Description: "Start EDEN Smart Estate now"; Flags: postinstall nowait skipifsilent shellexec

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"

[Code]
function HasWinget: Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\cmd.exe'), '/c where winget >nul 2>&1', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

procedure StopRunningEden(Dir: String; Script: String);
var
  Code: Integer;
begin
  if FileExists(Script) then
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Dir "' + Dir + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  // a running copy would hold files open: stop it (its data is safe on disk)
  StopRunningEden(ExpandConstant('{app}\app'), ExpandConstant('{tmp}\stop-eden.ps1'));
  Result := '';
end;

function InitializeUninstall: Boolean;
begin
  StopRunningEden(ExpandConstant('{app}\app'), ExpandConstant('{app}\app\scripts\stop-eden.ps1'));
  Result := True;
end;

var
  SavedAppDir: String;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Remove: Boolean;
begin
  // {app} is no longer available after the files are gone: remember it while it still is
  if CurUninstallStep = usUninstall then
    SavedAppDir := ExpandConstant('{app}');
  if CurUninstallStep <> usPostUninstall then Exit;
  Log('Post-uninstall: app dir [' + SavedAppDir + '], REMOVEDATA=[' + ExpandConstant('{param:REMOVEDATA|0}') + ']');
  if SavedAppDir = '' then Exit;
  DataDir := SavedAppDir + '\data';
  if not DirExists(DataDir) then Exit;
  Remove := ExpandConstant('{param:REMOVEDATA|0}') = '1';
  if (not Remove) and (not UninstallSilent) then
    Remove := MsgBox('Also delete your estate data (properties, documents, photos, backups) in' + #13#10 + DataDir + ' ?' + #13#10#13#10 +
                     'Choose No to keep it: a later installation will find it again.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  if Remove then
  begin
    Log('Deleting the data folder ' + DataDir + ': ' + IntToStr(Ord(DelTree(DataDir, True, True, True))));
    RemoveDir(SavedAppDir);
  end;
end;
