from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import asyncio

from . import auth, config, db, manage, neighbours, ocr, onvif, plantpictures, push, smart, smart_mqtt, terrain
from .providers import router as providers_router
from .routes import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    db.migrate()
    auth.bootstrap()
    smart.start_mqtt_all()
    task = asyncio.create_task(smart.poll_loop(config.POLL_SECONDS)) if config.POLL_SECONDS > 0 else None
    try:
        yield
    finally:
        if task:
            task.cancel()
        smart_mqtt.stop_all()


app = FastAPI(title="EDEN Smart Estate", version="1.3.0", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(router)
app.include_router(providers_router)
app.include_router(smart.router)
app.include_router(manage.router)
app.include_router(push.router)
app.include_router(ocr.router)
app.include_router(onvif.router)
app.include_router(terrain.router)
app.include_router(neighbours.router)
app.include_router(plantpictures.router)
app.middleware("http")(auth.guard)

dist = config.FRONTEND_DIST
if (dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            if candidate.name in ("sw.js", "manifest.webmanifest"):  # the browser must always re-check these so updates arrive
                return FileResponse(candidate, headers={"Cache-Control": "no-cache"},
                                    media_type="application/manifest+json" if candidate.suffix == ".webmanifest" else "text/javascript")
            return FileResponse(candidate)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
