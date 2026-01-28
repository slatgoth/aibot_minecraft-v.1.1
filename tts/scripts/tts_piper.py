import argparse
import os
import sys

import soundfile as sf
import onnxruntime as ort
from piper import PiperVoice


def resolve_config_path(model_path: str, config_path: str | None) -> str:
    if config_path:
        return config_path
    if os.path.exists(model_path + ".json"):
        return model_path + ".json"
    candidate = os.path.splitext(model_path)[0] + ".json"
    if os.path.exists(candidate):
        return candidate
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text")
    parser.add_argument("--out")
    parser.add_argument("--model")
    parser.add_argument("--config", default="")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--list_models", action="store_true")
    parser.add_argument("--models_dir", default="")
    args = parser.parse_args()

    if args.list_models:
        if not args.models_dir:
            print("error: --models_dir required for --list_models", file=sys.stderr)
            sys.exit(1)
        models = []
        for root, _, files in os.walk(args.models_dir):
            for f in files:
                if f.lower().endswith(".onnx"):
                    models.append(os.path.join(root, f))
        print("models:")
        for m in models:
            print(m)
        return

    if not args.text or not args.out or not args.model:
        print("error: --text, --out, and --model are required", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.model):
        print(f"error: model not found: {args.model}", file=sys.stderr)
        sys.exit(1)

    config_path = resolve_config_path(args.model, args.config)
    if not config_path or not os.path.exists(config_path):
        print("error: config (.json) not found", file=sys.stderr)
        sys.exit(1)

    use_cuda = args.device == "cuda"
    providers = ort.get_available_providers()
    if use_cuda and "CUDAExecutionProvider" not in providers:
        print("warning: CUDA provider not available, falling back to CPU")
        use_cuda = False
    voice = PiperVoice.load(args.model, config_path, use_cuda=use_cuda)
    audio = voice.synthesize(args.text)
    sf.write(args.out, audio, voice.config.sample_rate)


if __name__ == "__main__":
    main()
