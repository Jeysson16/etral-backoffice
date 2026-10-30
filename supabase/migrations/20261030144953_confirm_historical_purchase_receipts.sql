-- La fecha estimada de compra se mantiene separada de la recepción real.
-- NULL significa que la llegada aún no fue confirmada por el usuario.
alter table public.historical_material_purchases
  add column if not exists received_on date;
