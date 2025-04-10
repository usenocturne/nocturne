@echo off

if not exist "nocturne_image.zip" (
    echo nocturne_image.zip is missing
    exit /b 1
)

if not exist "nocturne_image.zip.sha256" (
    echo nocturne_image.zip.sha256 is missing
    exit /b 1
)

for /f "tokens=2 delims==" %%A in ('wmic os get osarchitecture /value ^| find "="') do set arch=%%A

if not exist "flashthing-cli.exe" (
    if /i "%arch%"=="64-bit" (
        echo Downloading flashthing-cli-windows-x86_64.exe
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-windows-x86_64.exe' -OutFile 'flashthing-cli.exe'"
    ) else (
        echo Downloading flashthing-cli-windows-aarch64.exe
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-windows-aarch64.exe' -OutFile 'flashthing-cli.exe'"
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
    echo Verifying checksum...
    for /f "tokens=1,2" %%A in ('type nocturne_image.zip.sha256') do (
        certutil -hashfile nocturne_image.zip SHA256 | find "%%A" >nul
        if errorlevel 1 (
            echo Checksum verification failed
            exit /b 1
        )
    )

    flashthing-cli.exe .\nocturne_image.zip
) else (
    echo Operation cancelled.
)

pause
exit /b 0
