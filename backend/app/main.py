from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import asyncio

from . import auth, config, db, manage, smart, smart_mqtt
from .providers import router as providers_router
from .routes import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    db.migrate()
    smart.start_mqtt_all()
    task = asyncio.create_task(smart.poll_loop(config.POLL_SECONDS)) if config.POLL_SECONDS > 0 else None
    try:
        yield
    finally:
        if task:
            task.cancel()
        smart_mqtt.stop_all()


app = FastAPI(title="EDEN Smart Estate", version="1.0.0", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(router)
app.include_router(providers_router)
app.include_router(smart.router)
app.include_router(manage.router)
app.middleware("http")(auth.guard)

dist = config.FRONTEND_DIST
if (dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")
