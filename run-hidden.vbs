' Starts the runner with no window. Used by the Startup shortcut and the 02:00 task that install.ps1 creates.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node runner.mjs", 0, False
