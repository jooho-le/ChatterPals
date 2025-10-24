import os
import uvicorn
from fastapi import FastAPI

from service_voice.server import app as voice_app
from service_text.server import app as text_app

app = FastAPI(title="ChatterPals Unified API", version="1.0.0")

app.mount("/voice", voice_app)
app.mount("/text", text_app)

@app.get("/")
def root_status():
    return {
        "status": "Unified ChatterPals API is running",
        "routes": ["/voice", "/text"],
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))  # Render가 PORT 줬으면 그걸 쓰고, 없으면 5000
    uvicorn.run(app, host="0.0.0.0", port=port)

