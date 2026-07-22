import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import CecoCodeRequest, FactorySnapshot, SimulationRun
from .services import evaluate_mrp, generate_ceco, simulate_comparison

app = FastAPI(title="ETRAL Digital Twin API", version="0.1.0")
allowed_origins = os.getenv("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/v1/cecos/code")
def new_ceco_code(request: CecoCodeRequest) -> dict:
    try:
        return {"ceco": generate_ceco(request.year, request.last_sequence)}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/v1/mrp/evaluate")
def mrp(snapshot: FactorySnapshot) -> dict:
    return evaluate_mrp(snapshot)


@app.post("/api/v1/simulations")
def run_simulation(run: SimulationRun) -> dict:
    return {"name": run.name, "result": simulate_comparison(run.input)}
