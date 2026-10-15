-- Alinea los códigos de fase de los Excel con la ruta productiva:
-- 1 Abastecimiento, 2 Corte y 3 Prepintado.

update public.bom_items bom
set stage_id = 'stage-cut'
from public.body_types product
where product.id = bom.body_type_id
  and product.code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
  and bom.stage_id = 'stage-prepaint';

with phase_three(product_code, description) as (
values
  ('PROD-FAC', 'ALAMBRE DE SOLDADURA E70XX'),
  ('PROD-FAC', 'ANCLAJE'),
  ('PROD-FAC', 'ARANDELA ZINCADA DE PRESION DE 5/16'),
  ('PROD-FAC', 'ARANDELA ZINCADA PLANA DE 5/16'),
  ('PROD-FAC', 'ARGO MIX'),
  ('PROD-FAC', 'BASE DE FARO LATERAL ESTANDARIZADA'),
  ('PROD-FAC', 'BISAGRA LATERAL 01147'),
  ('PROD-FAC', 'BISAGRA POSTERIOR 01116'),
  ('PROD-FAC', 'BROCA COBALTADA DE 1/4"'),
  ('PROD-FAC', 'BROCA COBALTADA DE 5/16"'),
  ('PROD-FAC', 'DISCO DE CORTE FENE 4.1/2"'),
  ('PROD-FAC', 'DISCO DE CORTE FENE 7"'),
  ('PROD-FAC', 'KIT DE CIERRE 211254'),
  ('PROD-FAC', 'PATAS DE GALLO'),
  ('PROD-FAC', 'PERNO ZINCADO CABEZA COCHE DE 5/16" X 1"'),
  ('PROD-FAC', 'PERNO ZINCADO CABEZA COCHE DE 5/16" X 2.1/2"'),
  ('PROD-FAC', 'PERNO ZINCADO HEX DE 5/16" X 1"'),
  ('PROD-FAC', 'PERNO ZINCADO HEX DE 5/16" X 2"'),
  ('PROD-FAC', 'PERNO ZINCADO HEX DE 5/16" X 2.1/2"'),
  ('PROD-FAC', 'REFUERZO FRONTAL ESTANDARIZADO TIPO 2'),
  ('PROD-FAC', 'TIZA CALDERERA'),
  ('PROD-FAC', 'TUERCA ZINCADA DE 5/16'),
  ('PROD-PLT', 'ALAMBRE DE SOLDADURA E70XX'),
  ('PROD-PLT', 'ARANDELA PLANA 1/2" GRADO 8'),
  ('PROD-PLT', 'ARANDELA ZINCADA PLANA DE 5/16'),
  ('PROD-PLT', 'ARGO MIX'),
  ('PROD-PLT', 'BASE DE FARO LATERAL ESTANDARIZADA'),
  ('PROD-PLT', 'BISAGRA PESADA PARA BARANDA 01319'),
  ('PROD-PLT', 'BISAGRA POSTERIOR 01116'),
  ('PROD-PLT', 'BROCA COBALTADA DE 1/4"'),
  ('PROD-PLT', 'BROCA COBALTADA DE 5/16"'),
  ('PROD-PLT', 'DISCO DE CORTE FENE 4.1/2"'),
  ('PROD-PLT', 'DISCO DE CORTE FENE 7"'),
  ('PROD-PLT', 'GANCHO DE 3/8'),
  ('PROD-PLT', 'KIT DE CIERRE 134121'),
  ('PROD-PLT', 'PERNO HEXAGONAL 1/2" X 1" GRADO 8'),
  ('PROD-PLT', 'PERNO HEXAGONAL 1/2" X 2.1/4" GRADO 8'),
  ('PROD-PLT', 'PERNO ZINCADO CABEZA DE COCHE DE 5/16" X 1"'),
  ('PROD-PLT', 'PERNO ZINCADO HEX DE 5/16" X 1"'),
  ('PROD-PLT', 'TIZA CALDERERA'),
  ('PROD-PLT', 'TUERCA STOP 1/2" GRADO 8'),
  ('PROD-PLT', 'TUERCA ZINCADA STOP DE 5/16'),
  ('PROD-PLT', 'WINCHE SOLDABLE'),
  ('PROD-BMI', 'ALAMBRE DE SOLDADURA E70XX'),
  ('PROD-BMI', 'ANCLAJE'),
  ('PROD-BMI', 'ANGULO P/ TEMPLADOR 1.1/4 X 3/16'),
  ('PROD-BMI', 'ARANDELA ZINCADA DE PRESION DE 5/16'),
  ('PROD-BMI', 'ARANDELA ZINCADA PLANA DE 5/16'),
  ('PROD-BMI', 'ARGO MIX'),
  ('PROD-BMI', 'BASE DE FARO LATERAL ESTANDARIZADA'),
  ('PROD-BMI', 'BISAGRA POSTERIOR 01111'),
  ('PROD-BMI', 'BROCA COBALTADA DE 1/4"'),
  ('PROD-BMI', 'BROCA COBALTADA DE 5/16"'),
  ('PROD-BMI', 'DISCO DE CORTE FENE 7"'),
  ('PROD-BMI', 'GANCHO LATERALES'),
  ('PROD-BMI', 'KIT DE CIERRE 134121'),
  ('PROD-BMI', 'PATA DE GALLO'),
  ('PROD-BMI', 'PERNO ZINCADO CABEZA DE COCHE 5/16" X 1"'),
  ('PROD-BMI', 'PERNO ZINCADO HEX DE 5/16" X 1"'),
  ('PROD-BMI', 'PERNO ZINCADO HEX DE 5/16" X 2.1/2"'),
  ('PROD-BMI', 'REFUERZO FRONTAL TIPO 1'),
  ('PROD-BMI', 'TIZA CALDERERA'),
  ('PROD-BMI', 'TUERCA ZINCADA DE 5/16'),
  ('PROD-BMI', 'TUERCA ZINCADA STOP DE 5/16'),
  ('PROD-BTE', 'ALAMBRE DE SOLDADURA E70XX'),
  ('PROD-BTE', 'ANCLAJE'),
  ('PROD-BTE', 'ANGULO P/ TEMPLADOR 1.1/4 X 3/16'),
  ('PROD-BTE', 'ARANDELA ZINCADA DE PRESION DE 5/16'),
  ('PROD-BTE', 'ARANDELA ZINCADA PLANA DE 5/16'),
  ('PROD-BTE', 'ARGO MIX'),
  ('PROD-BTE', 'BASE DE FARO LATERAL ESTANDARIZADA'),
  ('PROD-BTE', 'BISAGRA LATERAL (MODELO ANTIGUO)'),
  ('PROD-BTE', 'BISAGRA POSTERIOR 01111'),
  ('PROD-BTE', 'BROCA COBALTADA DE 1/4"'),
  ('PROD-BTE', 'BROCA COBALTADA DE 5/16"'),
  ('PROD-BTE', 'DISCO DE CORTE FENE 4.1/2"'),
  ('PROD-BTE', 'DISCO DE CORTE FENE 7"'),
  ('PROD-BTE', 'GANCHO PARA CARROCERIA'),
  ('PROD-BTE', 'KIT DE CIERRE 411251'),
  ('PROD-BTE', 'PATA DE GALLO'),
  ('PROD-BTE', 'PERNO ZINCADO HEX DE 5/16" X 1"'),
  ('PROD-BTE', 'PERNO ZINCADO HEX DE 5/16" X 2.1/2"'),
  ('PROD-BTE', 'REFUERZO FRONTAL ESTANDARIZADO TIPO 2'),
  ('PROD-BTE', 'TIZA CALDERERA'),
  ('PROD-BTE', 'TUERCA ZINCADA DE 5/16')
)
update public.bom_items bom
set stage_id = 'stage-prepaint'
from public.body_types product, phase_three source
where product.id = bom.body_type_id
  and product.code = source.product_code
  and bom.description = source.description;

do $$
declare
  order_row record;
begin
  for order_row in
    select orders.ceco
    from public.ceco_orders orders
    join public.body_types product on product.id = orders.body_type_id
    where product.code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
  loop
    perform public.refresh_order_material_reservations(order_row.ceco);
  end loop;
end $$;
