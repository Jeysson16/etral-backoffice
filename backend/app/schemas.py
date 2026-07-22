from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Material(BaseModel):
    code: str
    description: str
    physical: Decimal = Field(ge=0)
    committed: Decimal = Field(default=0, ge=0)
    safety: Decimal = Field(default=0, ge=0)
    service_factor: Decimal | None = Field(default=None, gt=0)
    demand_std_dev: Decimal | None = Field(default=None, ge=0)
    lead_time_days: Decimal | None = Field(default=None, gt=0)
    unit: str = "und"


class BomItem(BaseModel):
    body_type_id: str
    stage_id: str
    material_code: str
    quantity: Decimal = Field(gt=0)


class ProductionOrder(BaseModel):
    ceco: str = Field(pattern=r"^\d{6}$")
    body_type_id: str
    stage_id: str | None = None
    priority: int = Field(default=999, ge=1)
    progress: Decimal = Field(default=0, ge=0, le=100)
    due_date: date | None = None


class Stage(BaseModel):
    id: str
    name: str
    capacity_hours: Decimal = Field(gt=0)
    standard_hours: Decimal = Field(gt=0)
    sequence: int = Field(ge=1)
    color: str = "#f36b21"


class FactorySnapshot(BaseModel):
    """Estado operativo usado por el MRP y por una corrida del gemelo."""

    materials: list[Material]
    bom: list[BomItem]
    orders: list[ProductionOrder]
    stages: list[Stage]
    routes: dict[str, list[str]]

    @field_validator("routes")
    @classmethod
    def routes_cannot_be_empty(cls, routes: dict[str, list[str]]) -> dict[str, list[str]]:
        if any(not route for route in routes.values()):
            raise ValueError("Cada ruta debe tener al menos una estación")
        return routes


class CecoCodeRequest(BaseModel):
    year: int = Field(ge=2000, le=9999)
    last_sequence: int = Field(default=0, ge=0, le=9999)


class SimulationInput(BaseModel):
    snapshot: FactorySnapshot
    horizon_days: int = Field(default=14, ge=1, le=365)
    labor_availability: Decimal = Field(default=100, gt=0, le=100)
    shifts_per_day: int = Field(default=1, ge=1, le=3)
    demand_percent: Decimal = Field(default=100, gt=0, le=300)
    material_adjustments: dict[str, Decimal] = Field(default_factory=dict)
    priority_overrides: dict[str, int] = Field(default_factory=dict)


class SimulationRun(BaseModel):
    name: str = Field(min_length=3, max_length=100)
    input: SimulationInput


OrderState = Literal["ready", "blocked"]
