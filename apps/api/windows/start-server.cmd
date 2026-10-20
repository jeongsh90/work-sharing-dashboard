@echo off
rem WSD server launcher. Restarts the server 5 seconds after it stops.
rem Logs go to D:\WSD-Dashboard\logs\server.log
cd /d "%~dp0.."
if not exist "D:\WSD-Dashboard\logs" mkdir "D:\WSD-Dashboard\logs"
:loop
echo [%date% %time%] start>> "D:\WSD-Dashboard\logs\server.log"
"C:\Program Files\nodejs\node.exe" src\server.ts >> "D:\WSD-Dashboard\logs\server.log" 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
