import os
import logging
from contextlib import asynccontextmanager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from api.analyse import router as analyse_router
from api.stream import router as stream_router
from api.webhook import router as webhook_router
from api.data import router as data_router
from prompt_loader import seed_prompts_from_json
from db.seed_team import seed_team_if_empty
from agents.embed_guard import startup_embed


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        seed_prompts_from_json()
    except Exception:
        pass
    try:
        seed_team_if_empty()
    except Exception:
        pass
    try:
        import threading
        t = threading.Thread(target=startup_embed, daemon=True)
        t.start()
    except Exception:
        pass
    yield


app = FastAPI(title="SAGE", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyse_router, tags=["analyse"])
app.include_router(stream_router, tags=["stream"])
app.include_router(webhook_router, tags=["webhook"])
app.include_router(data_router, tags=["data"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "sage"}
