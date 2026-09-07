@echo off
title Compilador VeloSync
chcp 65001 >nul
cls

echo.
echo  ===========================================================
echo        COMPILANDO VELOSYNC.EXE (WINDOWS FORMS NATIVO C#)
echo  ===========================================================
echo.

set CSC_PATH_64=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set CSC_PATH_32=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe

if exist "%CSC_PATH_64%" (
    set CSC_CMD="%CSC_PATH_64%"
    goto :compiler_found
)

if exist "%CSC_PATH_32%" (
    set CSC_CMD="%CSC_PATH_32%"
    goto :compiler_found
)

echo  [ERRO] .NET Framework nao localizado!
echo  O arquivo csc.exe nao foi encontrado em:
echo  C:\Windows\Microsoft.NET\Framework64\v4.0.30319\
echo.
pause
exit /b 1

:compiler_found
echo  Compilador C# localizado com sucesso.
echo  Compilando VeloSync.cs...
echo.

:: Fonte e saída dentro de velosync/
%CSC_CMD% /target:winexe /out:"%~dp0..\velosync\VeloSync.exe" "%~dp0..\velosync\VeloSync.cs" /platform:anycpu /nologo

if %errorlevel% equ 0 (
    echo.
    echo  ===========================================================
    echo  [SUCESSO] VeloSync.exe compilado com sucesso!
    echo  ===========================================================
    echo.
    echo  Arquivo gerado em: velosync\VeloSync.exe
    echo.
    echo  Voce ja pode executar o VeloSync.exe para:
    echo  - Iniciar o servidor Node.js silenciosamente.
    echo  - Visualizar o icone de bandeja ao lado da bateria.
    echo  - Controlar a sincronizacao a cada 5 minutos via GUI.
    echo.
) else (
    echo.
    echo  [ERRO] Falha ao compilar o VeloSync.cs.
    echo.
)

pause