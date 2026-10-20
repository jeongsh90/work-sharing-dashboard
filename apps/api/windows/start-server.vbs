' Runs start-server.cmd without a console window. Used by the Startup shortcut.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & here & "\start-server.cmd""", 0, False
