@echo off
title Minecraft AI Bot Launcher
echo Starting Minecraft AI Bot Interface...
if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 goto :eof
)
npm start
pause
