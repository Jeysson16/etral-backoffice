export function pendingMaterialQuantity(dataset, order, piece) {
  const activities = (dataset.stageActivities || []).filter((activity) => activity.active !== false && activity.stageId === piece.stageId);
  if (piece.stageId && activities.length && activities.every((activity) =>
    (dataset.activityProgress || []).some((progress) => progress.ceco === order.ceco && progress.activityId === activity.id && (progress.status === "completed" || Number(progress.progress) >= 100)))) return 0;
  const reservation = (dataset.orderMaterialReservations || []).find((item) => item.ceco === order.ceco && item.bomItemId === piece.id);
  const alreadyIssued = Math.max(Number(reservation?.issuedQuantity || 0), Number(reservation?.consumedQuantity || 0));
  return Math.max(0, Number(piece.quantity || 0) - alreadyIssued);
}
