# Minecraft AI Bot v1.3.0 — Release Card

## Коротко
Electron‑панель + Mineflayer бот + Ollama LLM. Бот разговаривает, выполняет действия через скрытые JSON‑команды, видит окружение и озвучивает ответы через Piper TTS.

## Что умеет бот
- Общается с игроками через LLM, запоминает факты.
- Выполняет команды FOLLOW/GOTO/ATTACK/DROP/EQUIP/LOOKAT/STOP.
- Подходит к цели перед выдачей предмета.
- Отображает и управляет инвентарем из UI (drag‑and‑drop, drop zone).
- Имеет ручное управление (WASD, прыжок, stop, attack).
- Ведет логи, фильтры, копирование, очистку.
- Имеет Memory Matrix для редактирования памяти.
- Озвучивает ответы в игре через Piper TTS.

## Главное в 1.3.0
- Новый интерфейс панели (Terminal / Control / Inventory / Memory / Voice).
- Piper TTS вместо тяжелых решений, с очередью и лимитами.
- Команды LLM валидируются, мусорные action‑маркеры чистятся.
- Спам системных событий ограничен.
- Выдача предметов с подбеганием к игроку.

## Стек
Electron, Node.js, Mineflayer, Ollama, Piper TTS.

## Быстрый старт
`npm install` → `npm start`

## Требования
Node.js 20+, Java 17+ (ViaProxy), Ollama.
