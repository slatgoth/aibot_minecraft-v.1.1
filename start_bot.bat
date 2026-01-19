@echo off
echo Starting Minecraft LLM Bot...
echo Ensure ViaProxy is running if needed for 1.21.11 compatibility.
echo Ensure Ollama is running with a DeepSeek model.

cd /d "%~dp0"
call npm install
node src/index.js
pause
