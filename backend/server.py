import importlib.util
import pathlib
import sys
from fastapi import FastAPI


def load_app_from(path: str):
    file_path = pathlib.Path(path).resolve()
    spec = importlib.util.spec_from_file_location(file_path.stem, file_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    # Ensure the target directory is importable for local imports inside the module
    module_dir = str(file_path.parent)
    if module_dir not in sys.path:
        sys.path.insert(0, module_dir)
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    app = getattr(module, "app", None)
    if app is None:
        raise RuntimeError(f"No FastAPI 'app' found in {path}")
    return app


# Load sub-apps
VOICE_APP_PATH = "backend/service-voice/server.py"
TEXT_APP_PATH = "backend/service-text/server.py"

voice_app = load_app_from(VOICE_APP_PATH)
text_app = load_app_from(TEXT_APP_PATH)


# Compose a single FastAPI app
app = FastAPI(title="ChatterPals API (Unified)", version="1.0.0")


@app.get("/")
def root_status():
    return {
        "status": "ok",
        "services": {
            "text": "/text",
            "voice": "/voice",
        },
    }


# Mount sub‑applications under prefixes
app.mount("/voice", voice_app)
app.mount("/text", text_app)


def run(host: str = "0.0.0.0", port: int = 8000):
    import uvicorn
    print(f"Starting Unified Server on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=False)


if __name__ == "__main__":
    run()

