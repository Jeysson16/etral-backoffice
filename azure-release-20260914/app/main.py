import os
from functools import lru_cache
from pathlib import Path

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .schemas import CecoCodeRequest, FactorySnapshot, SimulationRun
from .services import evaluate_mrp, generate_ceco, simulate_comparison

app = FastAPI(title="ETRAL Digital Twin API", version="0.1.0")
allowed_origins = os.getenv("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    # Vite puede elegir otro puerto si el 5173 ya está ocupado. Este patrón
    # solo habilita orígenes locales; la publicación usa el mismo dominio.
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@lru_cache
def _jwks_client() -> jwt.PyJWKClient | None:
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    return jwt.PyJWKClient(f"{supabase_url}/auth/v1/.well-known/jwks.json") if supabase_url else None


def require_authenticated_user(authorization: str | None = Header(default=None)) -> dict:
    """Valida el JWT emitido por Supabase sin usar service_role ni una contraseña de BD.

    En desarrollo local puede omitirse SUPABASE_URL para ejecutar el API aislado.
    En Azure la variable es obligatoria y cada endpoint operativo exige un usuario autenticado.
    """
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not supabase_url:
        return {"sub": "local-development"}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere una sesión de Supabase.")
    try:
        token = authorization.removeprefix("Bearer ")
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=["ES256", "RS256"], audience="authenticated", issuer=f"{supabase_url}/auth/v1")
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="La sesión de Supabase no es válida.") from error


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/v1/cecos/code")
def new_ceco_code(request: CecoCodeRequest, _user: dict = Depends(require_authenticated_user)) -> dict:
    try:
        return {"ceco": generate_ceco(request.year, request.last_sequence)}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/v1/mrp/evaluate")
def mrp(snapshot: FactorySnapshot, _user: dict = Depends(require_authenticated_user)) -> dict:
    return evaluate_mrp(snapshot)


@app.post("/api/v1/simulations")
def run_simulation(run: SimulationRun, _user: dict = Depends(require_authenticated_user)) -> dict:
    return {"name": run.name, "result": simulate_comparison(run.input)}


static_dir = Path(__file__).resolve().parent / "static"
if static_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        candidate = static_dir / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(static_dir / "index.html")
