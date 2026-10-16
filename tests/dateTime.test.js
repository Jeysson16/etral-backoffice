import test from "node:test";
import assert from "node:assert/strict";
import { toLocalDateTimeInput, validateActivityTimes } from "../src/lib/dateTime.js";

test("conserva una fecha local lista para editar", () => {
  assert.equal(toLocalDateTimeInput("2026-10-15 10:23"), "2026-10-15T10:23");
});

test("valida el rango real de una actividad", () => {
  assert.equal(validateActivityTimes("2026-10-15T10:23", "2026-10-15T09:00", "completed"), "La fecha y hora de fin no pueden ser anteriores al inicio.");
  assert.equal(validateActivityTimes("2026-10-15T10:23", "", "completed"), "La fecha y hora de fin son obligatorias para una actividad completada.");
  assert.equal(validateActivityTimes("2026-10-15T10:23", "2026-10-15T11:00", "completed"), "");
});
