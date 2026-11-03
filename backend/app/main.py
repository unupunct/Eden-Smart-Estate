from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .providers import router as providers_router
from .routes import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    db.migrate()
    yield


app = FastAPI(title="EDEN Smart Estate", version="0.1.0", lifespan=lifespan)
app.include_router(router)
app.include_router(providers_router)

dist = config.FRONTEND_DIST
if (dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")
