# Minecraft AI Bot v1.3.0

Бот‑персонаж для Minecraft на базе Mineflayer + LLM (Ollama) с панелью управления на Electron. Видит окружение, хранит память о мире и игроках, выполняет действия через скрытые JSON‑команды и умеет озвучивать ответы через Piper TTS.

## Карточка проекта
- Название: Minecraft AI Bot
- Версия: 1.3.0
- Назначение: LLM‑бот в Minecraft с визуальной панелью, ручным управлением, памятью, инвентарем и голосом.
- Стек: Electron, Node.js, Mineflayer, Ollama, Piper TTS.
- Основные модули:
  - `main.js` — Electron + LLM оркестрация + TTS очередь.
  - `bot_wrapper.js` — Mineflayer бот, инвентарь, действия, навигация.
  - `index.html` — UI (Terminal, Control Deck, Inventory, Memory, Voice).
  - `tts/scripts/tts_piper.py` — генерация речи Piper.
- Сценарии: чат с игроками, команды, сопровождение, выдача предметов, ручной контроль, озвучка сообщений.

## Возможности
- Чат и действия через LLM (JSON‑команды в скрытых блоках).
- Панель управления: терминал, фильтры логов, команды.
- Manual‑control (WASD + jump, stop, attack).
- Inventory UI: drag‑and‑drop, выбор слота, зона сброса.
- Memory Matrix: база игроков и фактов, редактирование в UI.
- Voice Core: Piper TTS, выбор модели, тест озвучки, консоль статуса.
- ViaProxy интеграция для кросс‑версий.
- Безопасная обработка команд: очистка action‑маркеров и лишнего JSON.
- Дроп предметов с подбеганием к цели.
- Ограничение спама системных событий.

## Быстрый старт
1) Установить Node.js 20+.
2) Установить Java 17+ (для ViaProxy).
3) Установить Ollama и скачать модель:
   - `ollama serve`
   - `ollama pull <model>`
4) Установить зависимости:
   - `npm install`
5) Запуск:
   - `npm start`

Если ViaProxy нужен, разместите папку `ViaProxy` рядом с проектом и укажите сервер в UI (блок Connection).

## TTS (Piper)
1) Перейдите в `tts`:
   - `python -m venv .venv`
   - `.\.venv\Scripts\Activate.ps1`
2) Установите зависимости:
   - `pip install piper-tts onnxruntime soundfile numpy`
3) Скачайте голос:
   - положите `.onnx` и `.json` в `tts/models`
4) Вкладка **VOICE CORE**:
   - выберите модель и config
   - нажмите **Speak Test**

## Конфиденциальность
Личные данные и тяжелые артефакты (memory.json, модели, venv, wav‑файлы) не коммитятся. Смотрите `.gitignore`.

## Изменения v1.3.0
См. `CHANGELOG.md`.

## Лицензия
MIT (см. `LICENSE`).
