import unittest
from datetime import date
from decimal import Decimal

from app.schemas import ActivityProgress, BomItem, EquipmentResource, FactorySnapshot, IncidentResource, Material, OperationLog, PersonnelResource, ProductionOrder, SimulationInput, Stage, StageActivity
from app.services import _historical_validation, calibrate_digital_twin, evaluate_mrp, generate_ceco, simulate, simulate_comparison


def snapshot() -> FactorySnapshot:
    return FactorySnapshot(
        materials=[Material(code="PINT-BLA", description="Pintura blanca", physical=2, safety=0, unit="gal")],
        bom=[BomItem(body_type_id="furgon", stage_id="paint", material_code="PINT-BLA", quantity=2)],
        orders=[
            ProductionOrder(ceco="260180", body_type_id="furgon", stage_id="paint", priority=1),
            ProductionOrder(ceco="260181", body_type_id="furgon", stage_id="paint", priority=2),
        ],
        stages=[Stage(id="paint", name="Pintura", sequence=1, capacity_hours=8, standard_hours=8)],
        routes={"furgon": ["paint"]},
    )


class TwinServiceTests(unittest.TestCase):
    def test_generates_six_digit_ceco(self):
        self.assertEqual(generate_ceco(2026, 180), "260181")

    def test_mrp_assigns_material_to_highest_priority_ceco(self):
        result = evaluate_mrp(snapshot())
        reserved = [item for item in result["allocations"] if item["reserved"]]
        self.assertEqual(reserved[0]["ceco"], "260180")
        self.assertEqual(result["blocked_orders"][0]["ceco"], "260181")

    def test_simulation_is_isolated_and_marks_stock_block(self):
        result = simulate(SimulationInput(snapshot=snapshot(), labor_availability=50))
        self.assertTrue(result["scenario_isolated"])
        self.assertEqual(result["orders"]["blocked"], 1)
        self.assertTrue(result["stage_capacity"][0]["bottleneck"])

    def test_comparison_uses_frontend_contract(self):
        result = simulate_comparison(SimulationInput(snapshot=snapshot(), labor_availability=50, demand_percent=120))
        self.assertIn("baseline", result)
        self.assertIn("scenario", result)
        self.assertIn("stageCapacity", result["scenario"])
        self.assertGreater(result["scenario"]["stageCapacity"][0]["demandHours"], result["baseline"]["stageCapacity"][0]["demandHours"])

    def test_operational_resources_reduce_real_capacity(self):
        constrained_snapshot = snapshot().model_copy(update={
            "personnel": [PersonnelResource(id="p1", status="absent", efficiency=100, weekly_hours=48)],
            "equipment": [EquipmentResource(id="e1", stage_id="paint", status="restricted", capacity_hours=8)],
            "incidents": [IncidentResource(stage_id="paint", downtime_hours=Decimal("2"), status="open", severity="high")],
        })
        constrained = simulate(SimulationInput(snapshot=constrained_snapshot))
        regular = simulate(SimulationInput(snapshot=snapshot()))
        self.assertLess(constrained["stage_capacity"][0]["available_hours"], regular["stage_capacity"][0]["available_hours"])
        self.assertEqual(constrained["stage_capacity"][0]["incident_hours"], 2)

    def test_calibration_uses_only_closed_activities_linked_to_dop(self):
        trained = snapshot().model_copy(update={
            "personnel": [PersonnelResource(id="p1", status="active", efficiency=100)],
            "stage_activities": [StageActivity(id="act-paint", stage_id="paint", standard_minutes=60)],
            "activity_progress": [ActivityProgress(ceco="260180", activity_id="act-paint", status="completed", progress=100)],
            "operation_logs": [OperationLog(ceco="260180", activity_id="act-paint", worker_id="p1", total_hours=2)],
        })
        calibration = calibrate_digital_twin(trained)
        self.assertEqual(calibration["training_mode"], "calibrated")
        self.assertEqual(calibration["completed_activity_observations"], 1)
        self.assertGreater(calibration["standard_time_bias"], 1)
        self.assertEqual(calibration["linked_operation_logs"], 1)

    def test_schedule_respects_finite_capacity_and_marks_unscheduled_ceco(self):
        result = simulate(SimulationInput(snapshot=snapshot(), horizon_days=1, absenteeism_rate=0))
        schedule = {row["ceco"]: row for row in result["order_schedule"]}
        self.assertEqual(schedule["260181"]["state"], "blocked_material")
        self.assertEqual(schedule["260180"]["state"], "capacity_pending")
        self.assertEqual(result["orders"]["estimated_throughput"], 0)

    def test_pmp_is_measured_per_ceco_against_its_due_date(self):
        today = date.today().isoformat()
        yesterday = date.fromordinal(date.today().toordinal() - 1).isoformat()
        gantt_snapshot = snapshot().model_copy(update={
            "materials": [], "bom": [],
            "stages": [Stage(id="paint", name="Pintura", sequence=1, capacity_hours=100, standard_hours=8)],
            "orders": [
                ProductionOrder(ceco="260180", body_type_id="furgon", stage_id="paint", priority=1, planned_start_date=today, due_date=today),
                ProductionOrder(ceco="260181", body_type_id="furgon", stage_id="paint", priority=2, planned_start_date=today, due_date=yesterday),
            ],
        })
        result = simulate(SimulationInput(snapshot=gantt_snapshot, horizon_days=7, absenteeism_rate=0))
        self.assertEqual(result["pmp_summary"]["evaluable"], 2)
        self.assertEqual(result["pmp_summary"]["on_time"], 1)
        self.assertEqual(result["pmp_compliance"], 50)

    def test_historical_validation_requires_real_completion_dates(self):
        historical = snapshot().model_copy(update={
            "orders": [ProductionOrder(ceco="260180", body_type_id="furgon", progress=100, due_date="2026-01-10")],
            "activity_progress": [ActivityProgress(ceco="260180", activity_id="act-paint", status="completed", progress=100, finished_at="2026-01-12T16:00:00")],
        })
        validation = _historical_validation(historical)
        self.assertEqual(validation["ordersWithActualCompletion"], 1)
        self.assertEqual(validation["lateOrders"], 1)
        self.assertEqual(validation["averageDaysLate"], 2)


if __name__ == "__main__":
    unittest.main()
