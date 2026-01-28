Piper TTS (fast + many voices)

This setup uses Piper TTS for speed and stability.
You choose a voice by downloading a Piper .onnx model and its .json config.

Quick test (PowerShell)
1) Activate venv
   .\.venv\Scripts\Activate.ps1

2) Put a model into:
   tts\models\voice.onnx
   tts\models\voice.onnx.json

3) Synthesize
   python scripts\tts_piper.py --text "Привет, это тест." --out "outputs\\sample.wav" --model "models\\voice.onnx"

Notes
- First run downloads Piper dependencies (already installed).
- Use VOICE CORE in the app to select model/config and test.
