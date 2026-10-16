function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (hours * 60) + minutes;
}

export function shiftWeeklyHours(shift) {
  if (!shift) return 0;
  const start = timeToMinutes(shift.startTime);
  let end = timeToMinutes(shift.endTime);
  if (end <= start) end += 24 * 60;
  const dailyMinutes = Math.max(0, end - start - Number(shift.breakMinutes || 0));
  return (dailyMinutes * Number(shift.daysPerWeek || 1)) / 60;
}

export function personnelWeeklyHours(shifts = [], shiftIds = []) {
  const selected = new Set(shiftIds);
  return shifts
    .filter((shift) => selected.has(shift.id) && shift.active !== false)
    .reduce((total, shift) => total + shiftWeeklyHours(shift), 0);
}

export function formatHours(value) {
  return Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: 2 });
}
