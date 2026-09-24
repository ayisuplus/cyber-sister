@echo off
rem One-click start for Amie (local dev / thesis demo). See scripts\start-local.mjs for what it does.
chcp 65001 >nul
cd /d "%~dp0"
node scripts\start-local.mjs %*
pause
