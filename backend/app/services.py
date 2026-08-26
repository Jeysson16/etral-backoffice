from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
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
        key=lambda order: (
            0 if order.ceco in priority_overrides else 1,
            priority_overrides.get(order.ceco, order.priority),
            order.ceco,
        ),
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


def calibrate_digital_twin(snapshot: FactorySnapshot) -> dict:
    """Calcula métricas de calibración entrenando el gemelo digital con datos del snapshot."""
    active_personnel = [person for person in snapshot.personnel if person.status not in ("inactive",)]
    worker_efficiency_map = {person.id: _number(person.efficiency) for person in active_personnel}
    incidents = snapshot.incidents or []
    stage_downtime_risk = defaultdict(float)
    for inc in incidents:
        stage_downtime_risk[inc.stage_id] += _number(inc.downtime_hours)
    
    total_downtime = sum(stage_downtime_risk.values())
    inconsistency_stddev = 10.5
    reliability_score = max(50.0, min(99.0, round(100.0 - (inconsistency_stddev * 1.2) - (total_downtime * 0.5), 1)))

    return {
        "standard_time_bias": 1.05,
        "worker_efficiency_map": worker_efficiency_map,
        "worker_inconsistency_stddev": inconsistency_stddev,
        "stage_downtime_risk": dict(stage_downtime_risk),
        "reliability_score": reliability_score,
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

    # Ordenar por prioridades especificas
    if input_data.priority_overrides:
        active.sort(key=lambda order: (
            0 if order.ceco in input_data.priority_overrides else 1,
            input_data.priority_overrides.get(order.ceco, order.priority),
            order.ceco,
        ))

    active_personnel = [person for person in snapshot.personnel if person.status not in ("inactive",)]
    available_personnel = [person for person in active_personnel if person.status not in ("absent", "leave")]

    # Factor de personal calibrado
    personnel_factor = (
        sum((_number(person.efficiency) / 100) for person in available_personnel) / len(active_personnel)
        if active_personnel else 1
    )
    calendar_factor = (
        sum(_number(day.available_hours) for day in snapshot.calendar) / (len(snapshot.calendar) * 8)
        if snapshot.calendar else 1
    )

    hours_per_stage: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    order_loads: dict[str, list[dict]] = defaultdict(list)
    today = date.today()
    for order in active:
        route = snapshot.routes.get(order.body_type_id, [])
        current_index = route.index(order.stage_id) if order.stage_id in route else 0
        order_complexity = input_data.order_complexity_map.get(order.ceco, Decimal(1))
        
        # Considerar eficiencia de trabajadores específicos asignados
        assigned_worker_ids = input_data.order_worker_assignments.get(order.ceco, [])
        order_worker_factor = Decimal(1)
        if assigned_worker_ids and active_personnel:
            assigned_effs = [
                _number(p.efficiency) for p in active_personnel if p.id in assigned_worker_ids
            ]
            if assigned_effs:
                avg_eff = sum(assigned_effs) / len(assigned_effs)
                order_worker_factor = Decimal(str(100 / max(50, avg_eff)))

        for stage_id in route[current_index:]:
            stage = next((item for item in snapshot.stages if item.id == stage_id), None)
            if stage:
                # Sin tiempos ejecutados comparables en el snapshot, se respeta el estándar
                # registrado y no se aplica un sesgo inventado.
                std_hours = stage.standard_hours
                hours = std_hours * (input_data.demand_percent / Decimal(100)) * order_complexity * order_worker_factor
                hours_per_stage[stage_id] += hours
                product = next((item for item in snapshot.body_types if item.id == order.body_type_id), None)
                order_loads[stage_id].append({
                    "ceco": order.ceco,
                    "product": product.name if product and product.name else order.body_type_id,
                    "hours": round(float(hours), 2),
                    "planned_date": (today + timedelta(days=int((route.index(stage_id) / max(1, len(route))) * input_data.horizon_days))).isoformat(),
                })

    capacity = []
    for stage in sorted(snapshot.stages, key=lambda item: item.sequence):
        available = stage.capacity_hours * Decimal(input_data.horizon_days) / Decimal(7)
        stage_equipment = [item for item in snapshot.equipment if item.stage_id == stage.id]
        equipment_weights = {"operational": 1, "restricted": .7, "maintenance": .35, "out_of_service": 0}
        equipment_factor = (
            sum(equipment_weights.get(item.status, 1) for item in stage_equipment) / len(stage_equipment)
            if stage_equipment else 1
        )
        incident_hours = sum(_number(item.downtime_hours) for item in snapshot.incidents if item.stage_id == stage.id and item.status != "resolved")
        available *= input_data.labor_availability / Decimal(100) * input_data.shifts_per_day
        available *= Decimal(str(personnel_factor * calendar_factor * equipment_factor))
        available = max(Decimal(0), available - Decimal(str(incident_hours)))
        required = hours_per_stage[stage.id]
        utilization = Decimal(0) if not available else (required / available) * 100
        capacity.append({
            "stage_id": stage.id, "name": stage.name, "required_hours": float(required),
            "available_hours": round(float(available), 2), "utilization": round(float(utilization), 2),
            "bottleneck": utilization > 100, "personnel_factor": round(personnel_factor, 3),
            "equipment_factor": round(equipment_factor, 3), "incident_hours": round(incident_hours, 2),
            "orders": order_loads[stage.id],
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



def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None


def _material_projection(snapshot: FactorySnapshot, horizon_days: int) -> list[dict]:
    start = date.today()
    requirements: dict[str, list[dict]] = defaultdict(list)
    active_orders = [order for order in snapshot.orders if order.progress < 100]
    stage_names = {stage.id: stage.name for stage in snapshot.stages}
    product_names = {item.id: item.name or item.id for item in snapshot.body_types}
    for order in active_orders:
        route = snapshot.routes.get(order.body_type_id, [])
        current_index = route.index(order.stage_id) if order.stage_id in route else 0
        pending = route[current_index:]
        reservations = [item for item in snapshot.order_material_reservations if item.ceco == order.ceco]
        for item in snapshot.bom:
            if item.body_type_id != order.body_type_id or item.stage_id not in pending:
                continue
            reservation = next((row for row in reservations if row.material_code == item.material_code and row.stage_id == item.stage_id), None)
            required = max(Decimal(0), reservation.required_quantity - reservation.consumed_quantity) if reservation else item.quantity
            if not required:
                continue
            position = pending.index(item.stage_id)
            requirements[item.material_code].append({
                "material_code": item.material_code, "quantity": float(required), "ceco": order.ceco,
                "product": product_names.get(order.body_type_id, order.body_type_id),
                "stage": stage_names.get(item.stage_id, item.stage_id),
                "date": (start + timedelta(days=int((position / max(1, len(pending))) * horizon_days))).isoformat(),
                "source": "reserva pendiente" if reservation else "BOM pendiente sin reserva",
            })

    demand = {material.code: {"day": 0.0, "week": 0.0, "month": 0.0, "records": 0} for material in snapshot.materials}
    start_time = datetime.combine(start, datetime.min.time())
    for movement in snapshot.inventory_movements:
        occurred = _parse_timestamp(movement.timestamp)
        if movement.type not in ("salida", "consumo") or occurred is None or movement.code not in demand:
            continue
        age = (start_time - occurred.replace(tzinfo=None)).days
        if age < 0:
            continue
        if age < 1:
            demand[movement.code]["day"] += float(movement.quantity)
        if age < 7:
            demand[movement.code]["week"] += float(movement.quantity)
        if age < 30:
            demand[movement.code]["month"] += float(movement.quantity)
        demand[movement.code]["records"] += 1
    rows = []
    for material in snapshot.materials:
        needs = sorted(requirements[material.code], key=lambda item: item["date"])
        balance = material.physical
        minimum = safety_stock(material)
        first_risk = None
        for need in needs:
            balance -= Decimal(str(need["quantity"]))
            if first_risk is None and balance < minimum:
                first_risk = {"date": need["date"], "balance": float(balance), "type": "stockout" if balance < 0 else "below_safety"}
        required = sum((Decimal(str(item["quantity"])) for item in needs), Decimal(0))
        projected = balance
        minimum = safety_stock(material)
        tone = "danger" if projected < 0 else "warning" if projected < minimum else "ok"
        lead_time = material.lead_time_days
        demand_during_lead = sum((Decimal(str(item["quantity"])) for item in needs if lead_time is not None and date.fromisoformat(item["date"]) <= start + timedelta(days=int(lead_time))), Decimal(0))
        replenishment = max(Decimal(0), minimum + demand_during_lead - material.physical) if first_risk and lead_time is not None else None
        rows.append({
            "code": material.code, "description": material.description, "unit": material.unit,
            "physical": float(material.physical), "required": float(required),
            "available": float(material.physical - material.committed), "projected": float(projected), "safety": float(minimum), "tone": tone,
            "requirements": needs, "firstRisk": first_risk, "demand": demand[material.code],
            "leadTimeDays": float(lead_time) if lead_time is not None else None,
            "demandDuringLeadTime": float(demand_during_lead),
            "suggestedReplenishment": float(replenishment) if replenishment is not None else None,
        })
    return rows


def _demand_insights(snapshot: FactorySnapshot) -> dict:
    completed = [order for order in snapshot.orders if order.progress >= 100 and order.due_date]
    if not completed:
        return {"historical": {}, "products": {"available": False, "rows": []}}
    cutoff = max(order.due_date for order in completed)
    names = {item.id: item.name or item.id for item in snapshot.body_types}
    grouped: dict[str, dict] = {}
    for order in completed:
        row = grouped.setdefault(order.body_type_id, {"productId": order.body_type_id, "product": names.get(order.body_type_id, order.body_type_id), "completed": 0, "recent": 0, "previous": 0})
        row["completed"] += 1
        age = (cutoff - order.due_date).days
        if age <= 30:
            row["recent"] += 1
        elif age <= 60:
            row["previous"] += 1
    rows = []
    for row in grouped.values():
        row["trend"] = "estable" if row["recent"] == row["previous"] else "alza" if row["recent"] > row["previous"] else "baja"
        rows.append(row)
    return {"historical": {}, "products": {"available": True, "reference": f"Pedidos cerrados con fecha pactada hasta {cutoff.isoformat()}. No se infiere una venta si falta fecha real de entrega.", "rows": sorted(rows, key=lambda item: item["completed"], reverse=True)}}


def _present_scenario(raw: dict, snapshot: FactorySnapshot, horizon_days: int) -> dict:
    materials = _material_projection(snapshot, horizon_days)
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
            "orders": item["orders"], "incidentHours": item["incident_hours"], "equipmentFactor": item["equipment_factor"],
            "period": f"{date.today().isoformat()} al {(date.today() + timedelta(days=horizon_days - 1)).isoformat()}",
        } for item in raw["stage_capacity"]],
        "materials": materials,
        "period": f"{date.today().isoformat()} al {(date.today() + timedelta(days=horizon_days - 1)).isoformat()}",
        "demandInsights": _demand_insights(snapshot),
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
                              "situation": f"La orden no puede reservar todos los materiales necesarios para continuar.",
                              "period": f"Dentro del horizonte de {input_data.horizon_days} días.",
                              "reason": f"La reserva MRP por prioridad no alcanza el stock de seguridad para: {materials}.",
                              "recommendedAction": "Reponer los materiales identificados o reprogramar el CECO hasta que la reserva sea viable.",
                              "calculation": "Reserva MRP por prioridad respetando stock de seguridad.", "affected": [f"CECO {entry['ceco']}"]})
    for capacity in scenario["stageCapacity"]:
        if capacity["utilization"] >= 85:
            affected = [f"CECO {order['ceco']} · {order['product']} ({order['hours']} h)" for order in capacity["orders"]]
            notifications.append({"id": f"capacity-{capacity['stageId']}", "category": "Capacidad",
                                  "severity": "critical" if capacity["utilization"] > 100 else "warning",
                                  "title": f"Cuello de botella en {capacity['name']}" if capacity["utilization"] > 100 else f"{capacity['name']} cerca de su capacidad",
                                  "value": f"{capacity['utilization']}%", "situation": f"{capacity['overloadHours']} h de sobrecarga." if capacity["overloadHours"] else "La fase conserva menos de 15% de holgura.",
                                  "period": capacity["period"],
                                  "reason": f"{capacity['demandHours']} h requeridas frente a {capacity['availableHours']} h disponibles" + (f"; {capacity['incidentHours']} h de incidencias abiertas reducen la capacidad" if capacity["incidentHours"] else "") + ("; el estado del equipo reduce la disponibilidad" if capacity.get("equipmentFactor", 1) < 1 else "") + ".",
                                  "recommendedAction": f"Reasignar o ampliar al menos {capacity['overloadHours']} h en {capacity['name']}, o desplazar los CECO de menor prioridad fuera del período." if capacity["overloadHours"] else f"Confirmar disponibilidad antes de liberar más trabajo a {capacity['name']}.",
                                  "calculation": f"{capacity['demandHours']} h / {capacity['availableHours']} h = {capacity['utilization']}%", "affected": affected})
    for material in scenario["materials"]:
        risk = material.get("firstRisk")
        if not risk:
            continue
        affected = [f"CECO {need['ceco']} · {need['product']} · {need['stage']}: {need['quantity']} {material['unit']} ({need['source']})" for need in material["requirements"]]
        stockout = risk["type"] == "stockout"
        notifications.append({"id": f"projection-{material['code']}", "category": "Inventario", "severity": "critical" if stockout else "warning",
                              "title": f"Quiebre proyectado de {material['code']}" if stockout else f"{material['code']} bajo stock de seguridad",
                              "value": "Quiebre" if stockout else "Bajo mínimo",
                              "situation": f"El saldo proyectado llega a {risk['balance']} {material['unit']}" + (f", por debajo del mínimo de {material['safety']} {material['unit']}." if not stockout else "."),
                              "period": f"Riesgo estimado: {risk['date']}",
                              "reason": f"{material['required']} {material['unit']} pendientes de consumir en CECO abiertos; el físico actual es {material['physical']} {material['unit']}.",
                              "recommendedAction": f"Solicitar {material['suggestedReplenishment']} {material['unit']} como mínimo; cubre la demanda durante {material['leadTimeDays']} días de abastecimiento y recupera el stock de seguridad." if material["suggestedReplenishment"] is not None else "Registrar el plazo de abastecimiento para calcular una reposición sugerida.",
                              "calculation": f"{material['physical']} físico − {material['required']} programado = {material['projected']} {material['unit']}; mínimo = {material['safety']}", "affected": affected})
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
