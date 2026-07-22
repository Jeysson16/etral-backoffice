import unittest
from decimal import Decimal

from app.schemas import BomItem, EquipmentResource, FactorySnapshot, IncidentResource, Material, PersonnelResource, ProductionOrder, SimulationInput, Stage
from app.services import evaluate_mrp, generate_ceco, simulate, simulate_comparison


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


if __name__ == "__main__":
    unittest.main()
