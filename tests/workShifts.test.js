import test from "node:test";
import assert from "node:assert/strict";
import { personnelWeeklyHours, shiftWeeklyHours } from "../src/lib/workShifts.js";

const shifts = [
  { id: "t1", startTime: "08:00", endTime: "17:20", breakMinutes: 60, daysPerWeek: 4, active: true },
  { id: "t2", startTime: "08:00", endTime: "18:00", breakMinutes: 60, daysPerWeek: 1, active: true },
  { id: "t3", startTime: "08:00", endTime: "13:00", breakMinutes: 0, daysPerWeek: 1, active: true }
];

test("calcula las horas semanales de un turno según horario, descanso y días", () => {
  assert.equal(Number(shiftWeeklyHours(shifts[0]).toFixed(2)), 33.33);
  assert.equal(shiftWeeklyHours(shifts[1]), 9);
  assert.equal(shiftWeeklyHours(shifts[2]), 5);
});

test("suma las horas de todos los turnos asignados al trabajador", () => {
  assert.equal(Number(personnelWeeklyHours(shifts, ["t1", "t2", "t3"]).toFixed(2)), 47.33);
  assert.equal(Number(personnelWeeklyHours(shifts, ["t1", "t3"]).toFixed(2)), 38.33);
});

test("calcula correctamente un turno que cruza medianoche", () => {
  assert.equal(shiftWeeklyHours({ startTime: "22:00", endTime: "06:00", breakMinutes: 30, daysPerWeek: 5 }), 37.5);
});
