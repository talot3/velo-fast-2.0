@echo off
title TicketPro - Servidor Central
cls
echo.
echo  -------------------------------------------------
echo      INICIANDO SERVIDOR CENTRAL TICKET PRO
echo  -------------------------------------------------
echo.
cd /d "%~dp0.."
node server.js
pause
