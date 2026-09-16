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
    if (
        material.service_factor is not None and material.service_factor > 0
        and material.demand_std_dev is not None
        and material.lead_time_days is not None and material.lead_time_days > 0
    ):
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
    """Calibra parámetros sólo con partes que se pueden vincular al estándar.

    No adivina producción: estima multiplicadores auditables desde horas
    reportadas, actividades del DOP y personal. Si falta historia comparable,
    conserva los estándares en vez de inventar un sesgo de entrenamiento.
    """
    active_personnel = [person for person in snapshot.personnel if person.status != "inactive"]
    nominal_efficiency = {person.id: _number(person.efficiency) for person in active_personnel}
    activities = {activity.id: activity for activity in snapshot.stage_activities if activity.active}
    completed = {(item.ceco, item.activity_id) for item in snapshot.activity_progress if item.status == "completed" or item.progress >= 100}
    logged_by_activity: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal(0))
    logged_by_worker: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    expected_by_worker: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    linked_logs = 0
    for log in snapshot.operation_logs:
        if not log.activity_id or log.activity_id not in activities:
            continue
        linked_logs += 1
        key = (log.ceco, log.activity_id)
        logged_by_activity[key] += log.total_hours
        # La productividad individual se calcula sólo con trabajo terminado;
        # un parte de una actividad en curso no representa aún su duración total.
        if log.worker_id and key in completed:
            logged_by_worker[log.worker_id] += log.total_hours
            expected_by_worker[log.worker_id] += activities[log.activity_id].standard_minutes / Decimal(60)

    ratios: list[float] = []
    for key, actual_hours in logged_by_activity.items():
        # Un parte en una actividad no cerrada puede ser parcial.
        if key not in completed:
            continue
        expected_hours = activities[key[1]].standard_minutes / Decimal(60)
        if expected_hours > 0:
            ratios.append(max(0.5, min(2.5, _number(actual_hours / expected_hours))))

    observation_count = len(ratios)
    # Suavizado conservador: cinco observaciones equivalentes al estándar.
    standard_time_bias = round((5.0 + sum(ratios)) / (5.0 + observation_count), 3) if observation_count else 1.0
    worker_efficiency_map: dict[str, float] = {}
    worker_values: list[float] = []
    for person in active_personnel:
        actual = logged_by_worker.get(person.id, Decimal(0))
        expected = expected_by_worker.get(person.id, Decimal(0))
        if actual > 0 and expected > 0:
            efficiency = max(60.0, min(130.0, _number(expected / actual) * 100))
            worker_values.append(efficiency)
        else:
            efficiency = nominal_efficiency[person.id]
        worker_efficiency_map[person.id] = round(efficiency, 1)

    mean_efficiency = sum(worker_values) / len(worker_values) if worker_values else 100.0
    variance = sum((value - mean_efficiency) ** 2 for value in worker_values) / len(worker_values) if worker_values else 0.0
    stage_downtime_risk: dict[str, float] = defaultdict(float)
    for incident in snapshot.incidents:
        stage_downtime_risk[incident.stage_id] += _number(incident.downtime_hours)
    total_logs = len(snapshot.operation_logs)
    linkage = linked_logs / total_logs if total_logs else 0.0
    completion_coverage = observation_count / len(logged_by_activity) if logged_by_activity else 0.0
    sample_score = min(1.0, observation_count / 20)
    reliability_score = round(100 * (0.45 * sample_score + 0.35 * linkage + 0.20 * completion_coverage), 1)
    warnings = []
    if not total_logs:
        warnings.append("No hay partes de operación; se conservan los tiempos estándar.")
    elif not observation_count:
        warnings.append("No hay actividades cerradas con parte vinculado; no se ajustó el tiempo estándar.")
    if total_logs and linked_logs < total_logs:
        warnings.append(f"{total_logs - linked_logs} parte(s) no se vincularon a una actividad del DOP y no se usaron para calibrar.")
    return {
        "training_mode": "calibrated" if observation_count else "baseline_without_history",
        "standard_time_bias": standard_time_bias,
        "worker_efficiency_map": worker_efficiency_map,
        "worker_inconsistency_stddev": round(sqrt(variance), 1),
        "stage_downtime_risk": dict(stage_downtime_risk),
        "reliability_score": reliability_score,
        "sample_size_operations": total_logs,
        "linked_operation_logs": linked_logs,
        "completed_activity_observations": observation_count,
        "warnings": warnings,
    }


def _worker_factor(order_ceco: str, input_data: SimulationInput, snapshot: FactorySnapshot) -> Decimal:
    """Convierte la eficiencia de la cuadrilla asignada en horas requeridas."""
    assigned_worker_ids = input_data.order_worker_assignments.get(order_ceco, [])
    if not assigned_worker_ids:
        return Decimal(1)
    efficiencies = [_number(person.efficiency) for person in snapshot.personnel if person.id in assigned_worker_ids and person.status != "inactive"]
    if not efficiencies:
        return Decimal(1)
    return Decimal(str(100 / max(50, sum(efficiencies) / len(efficiencies))))


def _schedule_orders(
    snapshot: FactorySnapshot,
    input_data: SimulationInput,
    active_orders: list,
    blocked_cecos: set[str],
    stage_capacity: list[dict],
    standard_time_bias: float,
) -> list[dict]:
    """Programa CECOs en cola finita por fase y por día del horizonte.

    A diferencia de repartir la carga proporcionalmente, cada orden consume la
    capacidad que queda en su fase antes de liberar la siguiente. El resultado
    es determinista, reproducible y deja explícito qué CECO no cabe en el PMP.
    """
    start = date.today()
    dates = [start + timedelta(days=offset) for offset in range(input_data.horizon_days)]
    calendar = {item.date: item for item in snapshot.calendar}
    weights = [max(Decimal(0), calendar[item].available_hours / Decimal(8)) if item in calendar else Decimal(1) for item in dates]
    weight_total = sum(weights, Decimal(0))
    remaining: dict[str, list[Decimal]] = {}
    for row in stage_capacity:
        remaining[row["stage_id"]] = [
            (Decimal(str(row["available_hours"])) * weight / weight_total) if weight_total else Decimal(0)
            for weight in weights
        ]

    stages = {stage.id: stage for stage in snapshot.stages}
    products = {product.id: product.name or product.id for product in snapshot.body_types}
    ordered = sorted(active_orders, key=lambda order: (
        input_data.priority_overrides.get(order.ceco, order.priority), order.ceco,
    ))
    schedule = []
    for order in ordered:
        planned_start = order.planned_start_date or start
        planned_cursor = max(0, (planned_start - start).days)
        if order.ceco in blocked_cecos:
            schedule.append({
                "ceco": order.ceco, "product": products.get(order.body_type_id, order.body_type_id),
                "priority": input_data.priority_overrides.get(order.ceco, order.priority), "state": "blocked_material",
                "startDate": None, "endDate": None, "dueDate": order.due_date.isoformat() if order.due_date else None,
                "plannedStartDate": planned_start.isoformat(),
                "pmpState": "not_measurable" if not order.due_date else "not_compliant",
                "delayed": False, "stages": [],
            })
            continue

        route = snapshot.routes.get(order.body_type_id, [])
        current_index = route.index(order.stage_id) if order.stage_id in route else 0
        # El CECO no se adelanta artificialmente: su cola empieza en el inicio
        # PMP definido en su Gantt. Si ya venció, se evalúa desde hoy.
        cursor = planned_cursor
        stage_plan = []
        all_scheduled = True
        for stage_id in route[current_index:]:
            stage = stages.get(stage_id)
            if not stage:
                continue
            required = stage.standard_hours * Decimal(str(standard_time_bias))
            required *= input_data.demand_percent / Decimal(100)
            required *= input_data.order_complexity_map.get(order.ceco, Decimal(1))
            required *= _worker_factor(order.ceco, input_data, snapshot)
            balance = required
            first_day = None
            last_day = None
            for index in range(cursor, len(dates)):
                assigned = min(balance, remaining.get(stage_id, [Decimal(0)])[index])
                if assigned <= 0:
                    continue
                remaining[stage_id][index] -= assigned
                balance -= assigned
                first_day = index if first_day is None else first_day
                last_day = index
                if balance <= 0:
                    break
            stage_plan.append({
                "stageId": stage_id, "stage": stage.name, "requiredHours": round(float(required), 2),
                "scheduledHours": round(float(required - balance), 2),
                "startDate": dates[first_day].isoformat() if first_day is not None else None,
                "endDate": dates[last_day].isoformat() if balance <= 0 and last_day is not None else None,
            })
            if balance > 0:
                all_scheduled = False
                break
            # Las fases se liberan para la siguiente jornada, no instantáneamente.
            cursor = (last_day or 0) + 1

        first_date = next((item["startDate"] for item in stage_plan if item["startDate"]), None)
        end_date = stage_plan[-1]["endDate"] if all_scheduled and stage_plan else None
        due = order.due_date.isoformat() if order.due_date else None
        pmp_state = "not_measurable"
        if due:
            pmp_state = "on_time" if all_scheduled and end_date and end_date <= due else "not_compliant"
        schedule.append({
            "ceco": order.ceco, "product": products.get(order.body_type_id, order.body_type_id),
            "priority": input_data.priority_overrides.get(order.ceco, order.priority),
            "state": "scheduled" if all_scheduled else "capacity_pending", "startDate": first_date,
            "endDate": end_date, "dueDate": due,
            "plannedStartDate": planned_start.isoformat(), "pmpState": pmp_state,
            "delayed": bool(end_date and due and end_date > due) or not all_scheduled,
            "stages": stage_plan,
        })
    return schedule


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
    calibration = calibrate_digital_twin(snapshot)

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
        sum((calibration["worker_efficiency_map"].get(person.id, _number(person.efficiency)) / 100) for person in available_personnel) / len(active_personnel)
        if active_personnel else 1
    )
    personnel_factor *= float(Decimal(1) - (input_data.absenteeism_rate / Decimal(100)))
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
        order_worker_factor = _worker_factor(order.ceco, input_data, snapshot)

        for stage_id in route[current_index:]:
            stage = next((item for item in snapshot.stages if item.id == stage_id), None)
            if stage:
                std_hours = stage.standard_hours * Decimal(str(calibration["standard_time_bias"]))
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
        base_weekly_capacity = stage.capacity_hours
        stage_equipment = [item for item in snapshot.equipment if item.stage_id == stage.id]
        equipment_weights = {"operational": 1, "restricted": .7, "maintenance": .35, "out_of_service": 0}
        raw_equipment_capacity = sum((item.capacity_hours for item in stage_equipment), Decimal(0))
        effective_equipment_capacity = sum((item.capacity_hours * Decimal(str(equipment_weights.get(item.status, 1))) for item in stage_equipment), Decimal(0))
        if stage_equipment:
            # La capacidad efectiva ya incorpora el estado de cada equipo; no
            # se multiplica de nuevo por el factor para evitar doble castigo.
            base_weekly_capacity = min(base_weekly_capacity, effective_equipment_capacity)
        equipment_factor = _number(effective_equipment_capacity / raw_equipment_capacity) if raw_equipment_capacity else 1.0
        available = base_weekly_capacity * Decimal(input_data.horizon_days) / Decimal(7)
        incident_hours = sum(_number(item.downtime_hours) for item in snapshot.incidents if item.stage_id == stage.id and item.status != "resolved")
        available *= input_data.labor_availability / Decimal(100) * input_data.shifts_per_day
        available *= Decimal(str(personnel_factor * calendar_factor))
        available = max(Decimal(0), available - Decimal(str(incident_hours)))
        required = hours_per_stage[stage.id]
        utilization = Decimal(0) if not available else (required / available) * 100
        capacity.append({
            "stage_id": stage.id, "name": stage.name, "required_hours": float(required),
            "available_hours": round(float(available), 2), "utilization": round(float(utilization), 2),
            "bottleneck": utilization > 100, "personnel_factor": round(personnel_factor, 3),
            "equipment_factor": round(equipment_factor, 3), "incident_hours": round(incident_hours, 2),
            "base_weekly_capacity": float(base_weekly_capacity),
            "orders": order_loads[stage.id],
        })

    bottleneck = max(capacity, key=lambda item: item["utilization"], default=None)
    order_schedule = _schedule_orders(snapshot, input_data, active, blocked_cecos, capacity, calibration["standard_time_bias"])
    ready_orders = len([order for order in active if order.ceco not in blocked_cecos])
    throughput = sum(1 for row in order_schedule if row["state"] == "scheduled")
    pmp_evaluable = [row for row in order_schedule if row["dueDate"]]
    pmp_on_time = [row for row in pmp_evaluable if row["pmpState"] == "on_time"]
    return {
        "scenario_isolated": True,
        "orders": {"active": len(active), "ready": ready_orders, "blocked": len(blocked_cecos), "estimated_throughput": throughput},
        "mrp": mrp,
        "stage_capacity": capacity,
        "bottleneck": bottleneck["name"] if bottleneck and bottleneck["bottleneck"] else None,
        # PMP se mide por CECO frente a su propio Gantt: solo cumple si la
        # programación finita termina en o antes de su fecha comprometida.
        "pmp_compliance": round((len(pmp_on_time) / len(pmp_evaluable) * 100), 2) if pmp_evaluable else 100,
        "pmp_summary": {"evaluable": len(pmp_evaluable), "on_time": len(pmp_on_time), "without_due_date": len(order_schedule) - len(pmp_evaluable)},
        "calibration": calibration,
        "order_schedule": order_schedule,
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


def _historical_validation(snapshot: FactorySnapshot) -> dict:
    """Mide qué tan auditable es el histórico antes de reclamar precisión predictiva."""
    completed = [order for order in snapshot.orders if order.progress >= 100 and order.due_date]
    finished_by_ceco: dict[str, date] = {}
    for row in snapshot.activity_progress:
        if row.status != "completed" or not row.finished_at:
            continue
        parsed = _parse_timestamp(row.finished_at)
        if not parsed:
            continue
        finished = parsed.date()
        previous = finished_by_ceco.get(row.ceco)
        if previous is None or finished > previous:
            finished_by_ceco[row.ceco] = finished
    observed = [order for order in completed if order.ceco in finished_by_ceco]
    deviations = [(finished_by_ceco[order.ceco] - order.due_date).days for order in observed]
    late = [days for days in deviations if days > 0]
    return {
        "completedOrders": len(completed),
        "ordersWithActualCompletion": len(observed),
        "missingActualCompletion": len(completed) - len(observed),
        "onTimeOrders": sum(1 for days in deviations if days <= 0),
        "lateOrders": len(late),
        "onTimeRate": round(100 * sum(1 for days in deviations if days <= 0) / len(observed), 1) if observed else None,
        "averageDaysLate": round(sum(late) / len(late), 1) if late else 0,
        "readyForBacktesting": len(observed) >= 10,
        "message": "Histórico suficiente para contrastar proyecciones por cohorte." if len(observed) >= 10 else "Se requieren al menos 10 CECO cerrados con fecha real de la última actividad para validar pronósticos por cohorte.",
    }


def _present_scenario(raw: dict, snapshot: FactorySnapshot, horizon_days: int) -> dict:
    materials = _material_projection(snapshot, horizon_days)
    active = raw["orders"]["active"]
    throughput = raw["orders"]["estimated_throughput"]
    completion_ratio = throughput / active if active else 1
    scheduled = raw["order_schedule"]
    completed_leads = [
        (date.fromisoformat(row["endDate"]) - date.fromisoformat(row["startDate"])).days + 1
        for row in scheduled if row["state"] == "scheduled" and row["startDate"] and row["endDate"]
    ]
    return {
        "activeOrders": active,
        "throughput": throughput,
        "pmpCompliance": raw["pmp_compliance"],
        "pmpSummary": raw["pmp_summary"],
        "delayedOrders": sum(1 for row in scheduled if row["delayed"]),
        "stockouts": sum(1 for material in materials if material["projected"] < 0),
        "estimatedLeadDays": round(sum(completed_leads) / len(completed_leads), 1) if completed_leads else round(horizon_days / max(0.35, completion_ratio), 1),
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
        "cecoSchedule": scheduled,
        "demandInsights": _demand_insights(snapshot),
        "historicalValidation": _historical_validation(snapshot),
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
    for row in scenario["cecoSchedule"]:
        if row["state"] != "capacity_pending":
            continue
        pending_stage = row["stages"][-1] if row["stages"] else None
        notifications.append({"id": f"schedule-{row['ceco']}", "category": "Programación", "severity": "critical",
                              "title": f"CECO {row['ceco']} no cabe en el horizonte", "value": "Reprogramar",
                              "situation": "La cola finita por fase no pudo completar la orden dentro del período configurado.",
                              "period": f"Horizonte de {input_data.horizon_days} días.",
                              "reason": f"La última fase programada es {pending_stage['stage']} con {pending_stage['scheduledHours']} h de {pending_stage['requiredHours']} h asignadas." if pending_stage else "No hay capacidad disponible en la ruta pendiente.",
                              "recommendedAction": "Ampliar capacidad, agregar turno o desplazar un CECO de prioridad menor antes de prometer la fecha.",
                              "calculation": "Programación secuencial por CECO, prioridad y capacidad diaria remanente.", "affected": [f"CECO {row['ceco']}"]})
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
    raw_calibration = scenario_raw["calibration"]
    calibration = {
        "trainingMode": raw_calibration["training_mode"],
        "standardTimeBias": raw_calibration["standard_time_bias"],
        "workerEfficiencyMap": raw_calibration["worker_efficiency_map"],
        "workerInconsistencyStdDev": raw_calibration["worker_inconsistency_stddev"],
        "stageDowntimeRisk": raw_calibration["stage_downtime_risk"],
        "reliabilityScore": raw_calibration["reliability_score"],
        "sampleSizeOperations": raw_calibration["sample_size_operations"],
        "linkedOperationLogs": raw_calibration["linked_operation_logs"],
        "completedActivityObservations": raw_calibration["completed_activity_observations"],
        "warnings": raw_calibration["warnings"],
    }
    return {"params": params, "baseline": baseline, "scenario": scenario,
            "changes": changes, "notifications": notifications, "calibration": calibration}
