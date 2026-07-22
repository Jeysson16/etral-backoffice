from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING
from math import sqrt

from .schemas import FactorySnapshot, Material, SimulationInput


def _number(value: Decimal | float | int) -> float:
    return float(value)


def safety_stock(material: Material) -> Decimal:
    """SS = Z × desviación de demanda × raíz cuadrada del lead time."""
    if all(value is not None for value in (material.service_factor, material.demand_std_dev, material.lead_time_days)):
        calculated = _number(material.service_factor) * _number(material.demand_std_dev) * sqrt(_number(material.lead_time_days))
        return Decimal(str(calculated)).to_integral_value(rounding=ROUND_CEILING)
    return material.safety


def generate_ceco(year: int, last_sequence: int) -> str:
    if last_sequence >= 9999:
        raise ValueError("Se agotó la correlativa CECO para el año indicado")
    return f"{str(year)[-2:]}{last_sequence + 1:04d}"


def evaluate_mrp(snapshot: FactorySnapshot, priority_overrides: dict[str, int] | None = None) -> dict:
    """Reserva stock disponible por prioridad sin modificar el estado operativo."""
    priority_overrides = priority_overrides or {}
    materials = {material.code: material for material in snapshot.materials}
    balances = {code: material.physical - material.committed for code, material in materials.items()}
    bom_by_body: dict[str, list] = defaultdict(list)
    for item in snapshot.bom:
        bom_by_body[item.body_type_id].append(item)

    ordered = sorted(
        (order for order in snapshot.orders if order.progress < 100),
        key=lambda order: (priority_overrides.get(order.ceco, order.priority), order.ceco),
    )
    allocations, blocked = [], []
    for order in ordered:
        missing = []
        for item in bom_by_body[order.body_type_id]:
            material = materials.get(item.material_code)
            if material is None:
                missing.append({"material_code": item.material_code, "shortage": float(item.quantity), "reason": "material_not_registered"})
                continue
            before = balances[item.material_code]
            reserve_limit = safety_stock(material)
            after = before - item.quantity
            can_reserve = after >= reserve_limit
            allocations.append({
                "ceco": order.ceco,
                "material_code": item.material_code,
                "stage_id": item.stage_id,
                "required": float(item.quantity),
                "available_before": float(before),
                "available_after": float(after),
                "safety_stock": float(reserve_limit),
                "reserved": can_reserve,
            })
            if can_reserve:
                balances[item.material_code] = after
            else:
                missing.append({
                    "material_code": item.material_code,
                    "shortage": float(max(Decimal(0), reserve_limit - after)),
                    "reason": "safety_stock_or_shortage",
                })
        if missing:
            blocked.append({"ceco": order.ceco, "state": "blocked", "missing_materials": missing})

    return {
        "allocations": allocations,
        "blocked_orders": blocked,
        "available_balance": {code: float(value) for code, value in balances.items()},
    }


def simulate(input_data: SimulationInput) -> dict:
    """Calcula un escenario What-if; el snapshot recibido nunca se persiste ni altera."""
    snapshot = input_data.snapshot.model_copy(deep=True)
    adjustments = input_data.material_adjustments
    snapshot.materials = [
        material.model_copy(update={"physical": max(Decimal(0), material.physical + adjustments.get(material.code, Decimal(0)))})
        for material in snapshot.materials
    ]
    mrp = evaluate_mrp(snapshot, input_data.priority_overrides)
    blocked_cecos = {entry["ceco"] for entry in mrp["blocked_orders"]}
    active = [order for order in snapshot.orders if order.progress < 100]
    hours_per_stage: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for order in active:
        route = snapshot.routes.get(order.body_type_id, [])
        current_index = route.index(order.stage_id) if order.stage_id in route else 0
        for stage_id in route[current_index:]:
            stage = next((item for item in snapshot.stages if item.id == stage_id), None)
            if stage:
                hours_per_stage[stage_id] += stage.standard_hours * input_data.demand_percent / Decimal(100)

    capacity = []
    for stage in sorted(snapshot.stages, key=lambda item: item.sequence):
        available = stage.capacity_hours * Decimal(input_data.horizon_days) / Decimal(7)
        available *= input_data.labor_availability / Decimal(100) * input_data.shifts_per_day
        required = hours_per_stage[stage.id]
        utilization = Decimal(0) if not available else (required / available) * 100
        capacity.append({
            "stage_id": stage.id, "name": stage.name, "required_hours": float(required),
            "available_hours": round(float(available), 2), "utilization": round(float(utilization), 2),
            "bottleneck": utilization > 100,
        })

    bottleneck = max(capacity, key=lambda item: item["utilization"], default=None)
    capacity_ratio = min(1.0, 100 / max(100, bottleneck["utilization"])) if bottleneck else 1.0
    ready_orders = len([order for order in active if order.ceco not in blocked_cecos])
    throughput = min(ready_orders, int(len(active) * capacity_ratio))
    return {
        "scenario_isolated": True,
        "orders": {"active": len(active), "ready": ready_orders, "blocked": len(blocked_cecos), "estimated_throughput": throughput},
        "mrp": mrp,
        "stage_capacity": capacity,
        "bottleneck": bottleneck["name"] if bottleneck and bottleneck["bottleneck"] else None,
        "pmp_compliance": round((throughput / len(active) * 100), 2) if active else 100,
    }


def _material_projection(snapshot: FactorySnapshot) -> list[dict]:
    requirements: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    active_product_ids = [order.body_type_id for order in snapshot.orders if order.progress < 100]
    for item in snapshot.bom:
        requirements[item.material_code] += item.quantity * active_product_ids.count(item.body_type_id)
    rows = []
    for material in snapshot.materials:
        required = requirements[material.code]
        projected = material.physical - required
        minimum = safety_stock(material)
        tone = "danger" if projected < 0 else "warning" if projected < minimum else "ok"
        rows.append({
            "code": material.code, "description": material.description, "unit": material.unit,
            "physical": float(material.physical), "required": float(required),
            "projected": float(projected), "safety": float(minimum), "tone": tone,
        })
    return rows


def _present_scenario(raw: dict, snapshot: FactorySnapshot, horizon_days: int) -> dict:
    materials = _material_projection(snapshot)
    active = raw["orders"]["active"]
    throughput = raw["orders"]["estimated_throughput"]
    completion_ratio = throughput / active if active else 1
    return {
        "activeOrders": active,
        "throughput": throughput,
        "pmpCompliance": raw["pmp_compliance"],
        "delayedOrders": max(0, active - throughput),
        "stockouts": sum(1 for material in materials if material["projected"] < 0),
        "estimatedLeadDays": round(horizon_days / max(0.35, completion_ratio), 1),
        "bottleneck": raw["bottleneck"] or "Sin cuello de botella",
        "stageCapacity": [{
            "stageId": item["stage_id"], "name": item["name"], "color": next(stage.color for stage in snapshot.stages if stage.id == item["stage_id"]),
            "demandHours": item["required_hours"], "availableHours": item["available_hours"],
            "utilization": item["utilization"], "overloadHours": round(max(0, item["required_hours"] - item["available_hours"]), 2),
        } for item in raw["stage_capacity"]],
        "materials": materials,
    }


def simulate_comparison(input_data: SimulationInput) -> dict:
    """Entrega el escenario base y What-if con el contrato que consume el frontend."""
    baseline_input = input_data.model_copy(update={
        "labor_availability": Decimal(100), "shifts_per_day": 1,
        "demand_percent": Decimal(100), "material_adjustments": {}, "priority_overrides": {},
    })
    baseline_raw = simulate(baseline_input)
    scenario_raw = simulate(input_data)
    adjusted_snapshot = input_data.snapshot.model_copy(deep=True)
    adjusted_snapshot.materials = [
        material.model_copy(update={"physical": max(Decimal(0), material.physical + input_data.material_adjustments.get(material.code, Decimal(0)))})
        for material in adjusted_snapshot.materials
    ]
    baseline = _present_scenario(baseline_raw, input_data.snapshot, input_data.horizon_days)
    scenario = _present_scenario(scenario_raw, adjusted_snapshot, input_data.horizon_days)
    notifications = []
    for entry in scenario_raw["mrp"]["blocked_orders"]:
        materials = ", ".join(item["material_code"] for item in entry["missing_materials"])
        notifications.append({"id": f"stock-{entry['ceco']}", "category": "Inventario", "severity": "critical",
                              "title": f"CECO {entry['ceco']} detenido por falta de material", "value": "Bloqueado",
                              "equation": "Reserva MRP por prioridad respetando stock de seguridad.",
                              "detail": f"Materiales que impiden liberar la orden: {materials}.", "affected": [entry["ceco"]]})
    for capacity in scenario["stageCapacity"]:
        if capacity["utilization"] >= 85:
            notifications.append({"id": f"capacity-{capacity['stageId']}", "category": "Capacidad",
                                  "severity": "critical" if capacity["utilization"] > 100 else "warning",
                                  "title": f"Cuello de botella en {capacity['name']}" if capacity["utilization"] > 100 else f"{capacity['name']} cerca de su capacidad",
                                  "value": f"{capacity['utilization']}%", "equation": "Utilización = horas requeridas / horas disponibles × 100.",
                                  "detail": f"Sobrecarga de {capacity['overloadHours']} h dentro del horizonte.", "affected": []})
    changes = [
        f"Horizonte: {input_data.horizon_days} días.",
        f"Personal disponible: {input_data.labor_availability}%; {input_data.shifts_per_day} turno(s).",
        f"Demanda considerada: {input_data.demand_percent}% de las órdenes abiertas.",
        "La corrida es aislada: no modifica CECO, inventario ni prioridades operativas.",
    ]
    params = {
        "horizon_days": input_data.horizon_days, "labor_availability": float(input_data.labor_availability),
        "shifts_per_day": input_data.shifts_per_day, "demand_percent": float(input_data.demand_percent),
    }
    return {"params": params, "baseline": baseline, "scenario": scenario,
            "changes": changes, "notifications": notifications}
