import logging
from contextlib import asynccontextmanager

from bson import ObjectId
from fastapi import FastAPI, Request, encoders
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Mongo ObjectIds cross the wire as strings. Registering the encoder once here
# covers every route, including the ones that return a raw document rather than
# a response_model — otherwise each of those has to remember to stringify ids,
# and the one that forgets fails at runtime instead of at review.
encoders.ENCODERS_BY_TYPE[ObjectId] = str
encoders.encoders_by_class_tuples = encoders.generate_encoders_by_class_tuples(
    encoders.ENCODERS_BY_TYPE
)

from . import db as database
from .config import get_settings
from .routers import auth, cycles, exports, imports, issues, me, runs, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("rtt")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    yield
    await database.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Release testing tracker",
        version="1.0.0",
        description="HIS IT department, Amrita Hospital Faridabad.",
        lifespan=lifespan,
        root_path="/api",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        # Routes raise either a plain string or a dict carrying a machine code.
        # Normalise both into the {detail, code, ...} shape the frontend reads.
        detail = exc.detail
        body = detail if isinstance(detail, dict) else {"detail": str(detail)}
        return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)

    @app.get("/health", tags=["ops"])
    async def health():
        try:
            await database.get_db().command("ping")
            return {"status": "ok", "database": settings.mongo_db}
        except Exception as exc:
            return JSONResponse(status_code=503, content={"status": "degraded", "detail": str(exc)})

    for router in (auth.router, cycles.router, runs.router, issues.router, users.router, imports.router, exports.router, me.router):
        app.include_router(router)

    return app


app = create_app()
