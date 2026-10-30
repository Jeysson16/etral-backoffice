-- Lecturas del instrumento de tesis; el Kardex y los CECO operativos no se alteran.
create table if not exists public.thesis_productivity_measurements (
  phase text not null check (phase in ('pre', 'post')),
  ceco text not null,
  source_date date not null,
  product_description text not null,
  weight_kg numeric not null check (weight_kg > 0),
  worker_count integer not null check (worker_count > 0),
  labor_hours numeric not null check (labor_hours > 0),
  hourly_cost_pen numeric not null check (hourly_cost_pen >= 0),
  raw_material_cost_pen numeric not null check (raw_material_cost_pen >= 0),
  supplies_cost_pen numeric not null check (supplies_cost_pen >= 0),
  output_value_pen numeric not null check (output_value_pen >= 0),
  energy_cost_pen numeric check (energy_cost_pen >= 0),
  workbook_multifactor numeric,
  source_sheet text not null,
  source_row integer not null,
  primary key (phase, ceco)
);
alter table public.thesis_productivity_measurements enable row level security;
create policy thesis_productivity_read on public.thesis_productivity_measurements
  for select to authenticated
  using (not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false));
grant select on public.thesis_productivity_measurements to authenticated;

insert into public.thesis_productivity_measurements
(phase,ceco,source_date,product_description,weight_kg,worker_count,labor_hours,hourly_cost_pen,raw_material_cost_pen,supplies_cost_pen,output_value_pen,energy_cost_pen,workbook_multifactor,source_sheet,source_row)
values
  ('pre','260010','2026-01-09','FURGON LISO',1064.57,8,243.66,4.708333333333333,3579.83,4639.96,16100,1200,1.523607998374187,'Pre MO y MAT',8),
  ('pre','260050','2026-01-26','FURGON LISO',1064.57,8,240.66,4.708333333333333,3579.83,4639.96,16850,null,1.8015807400861603,'Pre MO y MAT',9),
  ('pre','260070','2026-01-29','PLATAFORMA',2334.4500000000003,8,154.8,4.708333333333333,21150.68,3984.84,30600,null,1.1830947361176785,'Pre MO y MAT',10),
  ('pre','260100','2026-02-16','PLATAFORMA',2334.4500000000003,8,159.8,4.708333333333333,21150.68,3984.84,30650,1200,1.1315010317948098,'Pre MO y MAT',11),
  ('pre','260160','2026-03-04','BARANDA TELERA',655.9299999999998,8,124.32,4.708333333333333,2092.88,2700.81,14500,1200,2.2039723181076845,'Pre MO y MAT',12),
  ('pre','260150','2026-03-05','FURGON ACANALADO',2899.09,8,301.15999999999997,4.708333333333333,9750.6,6205.920008135593,25000,1200,1.3459325776995683,'Pre MO y MAT',13),
  ('pre','260140','2026-03-06','FURGON ACANALADO',2899.09,8,251.66,4.708333333333333,9750.6,6205.920008135593,25000,null,1.4584556707387324,'Pre MO y MAT',14),
  ('pre','260170','2026-03-09','BARANDA MIXTA',624.2899999999998,8,157.32,4.708333333333333,1992.12,1828.27,4561.105,null,1,'Pre MO y MAT',15),
  ('pre','260210','2026-03-24','Baranda Telera',655.9299999999998,8,164.82,4.708333333333333,2092.88,2700.81,5569.717500000001,null,1,'Pre MO y MAT',16),
  ('pre','260230','2026-04-14','Baranda mixta',624.2899999999998,8,152.32,4.708333333333333,1992.12,1828.27,4537.5633333333335,1200,0.7908519818808101,'Pre MO y MAT',17),
  ('post','260350','2026-06-08','Baranda Mixta',624.2899999999998,8,65.5,4.708333333333333,1992.12,1828.27,11500,1200,2.158090109019519,'Post MO y MAT ',8),
  ('post','260560','2026-09-25','Furgón Liso',1064.57,8,73.25,4.708333333333333,3579.83,4639.961184067795,23600,null,2.7555039262050114,'Post MO y MAT ',9),
  ('post','260370','2026-06-17','Baranda Mixta',624.2899999999998,8,45.25,4.708333333333333,1992.12,1828.27,15500,null,3.8428715919952983,'Post MO y MAT ',10),
  ('post','260460','2026-08-18','Baranda Telera',655.9299999999998,8,63.25,4.708333333333333,2092.88,2700.8068949152544,11500,1200,1.8278661918917243,'Post MO y MAT ',11),
  ('post','260440','2026-07-27','Furgón Liso',1064.57,8,50,4.708333333333333,3579.83,4639.961184067795,20000,1200,2.071420968786148,'Post MO y MAT ',12),
  ('post','260420','2026-07-14','Baranda Mixta',624.2899999999998,8,65.5,4.708333333333333,1992.12,1828.27,11500,1200,2.158090109019519,'Post MO y MAT ',13),
  ('post','260400','2026-07-04','Furgón Acanalado',2899.09,8,93.75,4.708333333333333,9750.6,5257.52,23000,null,1.4887187883835595,'Post MO y MAT ',14),
  ('post','260380','2026-06-16','Furgón Liso',1064.57,8,65,4.708333333333333,3579.83,4639.961184067795,23600,null,2.7680580200404665,'Post MO y MAT ',15)
on conflict (phase, ceco) do nothing;
