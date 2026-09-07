@echo off
title TicketPro - Servidor PHP
chcp 65001 >nul
cls

echo.
echo  -------------------------------------------------
echo      TICKET PRO - SERVIDOR PHP EMBUTIDO
echo  -------------------------------------------------
echo.

:: Caminho do PHP instalado pelo INSTALAR_PHP.ps1
set PHP_LOCAL=%LOCALAPPDATA%\php\php.exe

:: Tenta o PHP local primeiro, depois o do PATH global
if exist "%PHP_LOCAL%" (
    set PHP_CMD=%PHP_LOCAL%
    echo  PHP encontrado em: %LOCALAPPDATA%\php
    goto :php_ok
)

where php >nul 2>&1
if %errorlevel% equ 0 (
    set PHP_CMD=php
    echo  PHP encontrado no PATH do sistema.
    goto :php_ok
)

echo  [ERRO] PHP nao encontrado!
echo.
echo  Execute primeiro o arquivo INSTALAR_PHP.ps1 para instalar
echo  o PHP automaticamente, ou instale manualmente em:
echo  https://windows.php.net/download/
echo.
pause
exit /b 1

:php_ok

:: Descobre o IP local da maquina
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
set LOCAL_IP=%LOCAL_IP: =%

echo.
echo  Iniciando servidor na porta 8080...
echo.
echo  -------------------------------------------------
echo   Painel Admin:   http://%LOCAL_IP%:8080
echo   PDV Terminal:   http://%LOCAL_IP%:8080/pdv/
echo  -------------------------------------------------
echo.
echo  Mantenha esta janela aberta para o sistema funcionar.
echo  Para parar o servidor, feche esta janela ou pressione Ctrl+C.
echo.

:: Navega para a raiz do projeto (um nível acima de _scripts/)
cd /d "%~dp0.."

"%PHP_CMD%" -S 0.0.0.0:8080 api\router.php

pause
