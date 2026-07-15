export function nextCecoCode(orders, now = new Date()) {
  const yearPrefix = String(now.getFullYear()).slice(-2);
  const maxSequence = orders
    .map((order) => String(order.ceco))
    .filter((ceco) => ceco.startsWith(yearPrefix))
    .map((ceco) => Number(ceco.slice(2)))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return `${yearPrefix}${String(maxSequence + 1).padStart(4, "0")}`;
}

export function nextInventoryCode(inventory, category = "MAT") {
  const prefix = category.toUpperCase().slice(0, 3);
  const maxSequence = inventory
    .map((item) => String(item.code))
    .filter((code) => code.startsWith(`${prefix}-`))
    .map((code) => Number(code.split("-")[1]))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return `${prefix}-${String(maxSequence + 1).padStart(4, "0")}`;
}

export function nextWarehouseTicket(tickets, prefix = "SAL") {
  const maxSequence = tickets
    .map((ticket) => String(ticket.ticket))
    .filter((ticket) => ticket.startsWith(`${prefix}-`))
    .map((ticket) => Number(ticket.split("-")[1]))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 7000);

  return `${prefix}-${maxSequence + 1}`;
}
