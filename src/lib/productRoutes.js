export function orderProductRoute(flowStages = [], route = []) {
  const stageOrder = new Map(flowStages.map((stage) => [stage.id, Number(stage.order)]));

  return [...new Set(route)]
    .filter((stageId) => stageOrder.has(stageId))
    .sort((left, right) => stageOrder.get(left) - stageOrder.get(right));
}
