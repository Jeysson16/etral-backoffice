export function toLocalDateTimeInput(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return text.replace(" ", "T").slice(0, 16);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.replace(" ", "T").slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function toUtcTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("La fecha y hora no son válidas");
  return date.toISOString();
}

export function validateActivityTimes(startedAt, finishedAt, status) {
  if (!startedAt) return "La fecha y hora de inicio son obligatorias.";
  if (status === "completed" && !finishedAt) return "La fecha y hora de fin son obligatorias para una actividad completada.";
  if (finishedAt && new Date(finishedAt).getTime() < new Date(startedAt).getTime()) return "La fecha y hora de fin no pueden ser anteriores al inicio.";
  return "";
}
