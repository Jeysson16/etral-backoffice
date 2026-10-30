-- Campos restantes del instrumento: A, O y sumas de los bloques Q–S.
alter table public.thesis_productivity_measurements
  add column base_hours numeric check (base_hours >= 0),
  add column capital_cost_pen numeric check (capital_cost_pen >= 0),
  add column group_multifactor_sum numeric,
  add column group_labor_sum numeric,
  add column group_material_sum numeric;

update public.thesis_productivity_measurements m
set base_hours = v.base_hours,
    capital_cost_pen = v.capital_cost_pen,
    group_multifactor_sum = v.group_multifactor_sum,
    group_labor_sum = v.group_labor_sum,
    group_material_sum = v.group_material_sum
from (values
  ('pre','260010',202.16,8219.79,4.508283474578025,23.8730498104404,0.3519006278377194),
  ('pre','260050',202.16,8219.79,null,null,null),
  ('pre','260070',124.8,25135.52,null,null,null),
  ('pre','260100',124.8,25135.52,1.1315010317948098,14.608573216520652,0.09287454566287072),
  ('pre','260160',120.32,4793.6900000000005,7.008360566545985,34.37037750662581,0.8004476569382695),
  ('pre','260150',202.16,15956.520008135594,null,null,null),
  ('pre','260140',202.16,15956.520008135594,null,null,null),
  ('pre','260170',120.32,3820.39,null,null,null),
  ('pre','260210',120.32,4793.6900000000005,null,null,null),
  ('pre','260230',120.32,3820.39,0.7908519818808101,4.098542542016806,0.163410018348912),
  ('post','260350',202.16,3820.39,8.756465627219828,37.860987966156166,0.45633305912878647),
  ('post','260560',202.16,8219.791184067795,null,null,null),
  ('post','260370',124.8,3820.39,null,null,null),
  ('post','260460',124.8,4793.686894915254,1.8278661918917243,10.370434782608694,0.13683204898003581),
  ('post','260440',120.32,8219.791184067795,8.486287886229693,78.12417170483461,0.6156041615469376),
  ('post','260420',202.16,3820.39,null,null,null),
  ('post','260400',202.16,15008.12,null,null,null),
  ('post','260380',120.32,8219.791184067795,null,null,null)
) as v(phase,ceco,base_hours,capital_cost_pen,group_multifactor_sum,group_labor_sum,group_material_sum)
where m.phase = v.phase and m.ceco = v.ceco;
