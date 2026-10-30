update public.ceco_orders as o
set output_weight_kg = round(m.weight_kg, 2)
from public.thesis_productivity_measurements as m
where m.phase = 'post'
  and m.ceco = o.ceco
  and o.productivity_basis = 'Instrumento de tesis · Post MO y MAT'
  and o.output_weight_kg is distinct from round(m.weight_kg, 2);
