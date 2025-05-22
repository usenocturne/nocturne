@echo off

if not exist "nocturne_image" (
    echo nocturne_image is missing
    exit /b 1
)

set "arch="
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "arch=ARM64"
) else if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set "arch=AMD64"
) else (
    set "arch=AMD64"
)

if not exist "flashthing-cli.exe" (
    if /i "%arch%"=="ARM64" (
        echo Downloading flashthing-cli-windows-aarch64.exe
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-windows-aarch64.exe' -OutFile 'flashthing-cli.exe'"
    ) else (
        echo Downloading flashthing-cli-windows-x86_64.exe
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-windows-x86_64.exe' -OutFile 'flashthing-cli.exe'"
    )

    if exist "flashthing-cli.exe" (
        echo Download complete
    ) else (
        echo Failed to download flashthing-cli.exe
        exit /b 1
    )
)

set /p proceed=This script will flash Nocturne onto your Car Thing. Continue? (y/n): 
if /i "%proceed%"=="y" (
    flashthing-cli.exe .\nocturne_image
) else (
    echo Operation cancelled.
)

pause
exit /b 0
