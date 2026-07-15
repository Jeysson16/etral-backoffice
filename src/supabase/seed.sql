-- Datos de demostración alineados con DOP DE FURGÓN ACANALADO y AVANCE DE CECOS.
insert into flow_stages (id, "order", name, short_name, capacity_hours, standard_hours, color, gated_by_quality) values
('stage-supply',0,'Abastecimiento','01',40,4,'#64748b',false),('stage-prepaint',1,'Pre-pintado','02',36,6,'#0ea5e9',true),
('stage-cut',2,'Corte de componentes','03',44,7,'#2563eb',false),('stage-assembly',3,'Armado','04',52,14,'#16a34a',false),
('stage-welding',4,'Soldado','05',48,12,'#059669',true),('stage-doors',5,'Kit de cierre y puertas','06',32,7,'#8b5cf6',true),
('stage-guards',6,'Defensas','07',28,6,'#a855f7',false),('stage-paint',7,'Pintado general','08',34,16,'#f97316',true),
('stage-mount',8,'Montaje sobre chasis','09',30,8,'#d97706',true),('stage-electrical',9,'Sistema eléctrico','10',30,6,'#eab308',true),
('stage-finish',10,'Acabados y entrega','11',38,8,'#0f766e',true)
on conflict (id) do update set "order"=excluded."order", name=excluded.name, short_name=excluded.short_name, capacity_hours=excluded.capacity_hours, standard_hours=excluded.standard_hours, color=excluded.color, gated_by_quality=excluded.gated_by_quality;

insert into stage_activities (id,stage_id,sequence,name,standard_minutes,active) values
('act-supply-1','stage-supply',1,'Adquisición de planchas y perfiles',60,true),('act-supply-2','stage-supply',2,'Recepción de materiales',75,true),('act-supply-3','stage-supply',3,'Transporte interno al área de corte',90,true),
('act-prepaint-1','stage-prepaint',1,'Descarga de material',60,true),('act-prepaint-2','stage-prepaint',2,'Lijado y limpieza con thinner',75,true),('act-prepaint-3','stage-prepaint',3,'Aplicación de acondicionador',90,true),('act-prepaint-4','stage-prepaint',4,'Aplicación de base',105,true),
('act-cut-1','stage-cut',1,'Inspección de medidas',60,true),('act-cut-2','stage-cut',2,'Trazado de componentes',75,true),('act-cut-3','stage-cut',3,'Corte de planchas y perfiles',90,true),
('act-assembly-1','stage-assembly',1,'Armado de falso chasis',60,true),('act-assembly-2','stage-assembly',2,'Colocación de puentes y durmientes',75,true),('act-assembly-3','stage-assembly',3,'Armado de laterales y frontal',90,true),('act-assembly-4','stage-assembly',4,'Colocación de piso',105,true),
('act-welding-1','stage-welding',1,'Nivelado de carrocería',60,true),('act-welding-2','stage-welding',2,'Soldeo de falso chasis',75,true),('act-welding-3','stage-welding',3,'Soldeo de estructura',90,true),('act-welding-4','stage-welding',4,'Inspección de cordones',105,true),
('act-doors-1','stage-doors',1,'Preparación de piezas',60,true),('act-doors-2','stage-doors',2,'Instalación de kit de cierre',75,true),('act-doors-3','stage-doors',3,'Soldado e instalación de puertas',90,true),
('act-guards-1','stage-guards',1,'Perforación de perfiles',60,true),('act-guards-2','stage-guards',2,'Habilitado de tubos',75,true),('act-guards-3','stage-guards',3,'Soldado e instalación de defensas',90,true),
('act-paint-1','stage-paint',1,'Esmerilado de soldaduras',60,true),('act-paint-2','stage-paint',2,'Masillado',75,true),('act-paint-3','stage-paint',3,'Lijado y pulido',90,true),('act-paint-4','stage-paint',4,'Aplicación de sellador y base',105,true),('act-paint-5','stage-paint',5,'Pintura final y acabado',120,true),
('act-mount-1','stage-mount',1,'Ubicación para montaje',60,true),('act-mount-2','stage-mount',2,'Montaje de carrocería',75,true),('act-mount-3','stage-mount',3,'Instalación e inspección de abrazaderas',90,true),
('act-electrical-1','stage-electrical',1,'Instalación de faros',60,true),('act-electrical-2','stage-electrical',2,'Cableado y fijación',75,true),('act-electrical-3','stage-electrical',3,'Prueba del sistema eléctrico',90,true),
('act-finish-1','stage-finish',1,'Instalación de cintas y logos',60,true),('act-finish-2','stage-finish',2,'Accesorios finales',75,true),('act-finish-3','stage-finish',3,'Limpieza, inspección y entrega',90,true)
on conflict (id) do update set name=excluded.name, standard_minutes=excluded.standard_minutes, active=excluded.active;

insert into body_types (id,code,family,name,target_days,output_unit) values
('body-van-ribbed','PROD-FAC','Furgones','Furgón Acanalado',16,'und'),('body-van-flat','PROD-FLI','Furgones','Furgón Liso',14,'und'),
('body-tank-5000','PROD-CIS','Cisternas','Cisterna 5000G',20,'und'),('body-mixed-rail','PROD-BMI','Barandas','Baranda Mixta',12,'und')
on conflict (id) do update set code=excluded.code,family=excluded.family,name=excluded.name,target_days=excluded.target_days,output_unit=excluded.output_unit;

insert into product_routes (product_id,stage_id,sequence) values
('body-van-ribbed','stage-supply',1),('body-van-ribbed','stage-prepaint',2),('body-van-ribbed','stage-cut',3),('body-van-ribbed','stage-assembly',4),('body-van-ribbed','stage-welding',5),('body-van-ribbed','stage-doors',6),('body-van-ribbed','stage-guards',7),('body-van-ribbed','stage-paint',8),('body-van-ribbed','stage-mount',9),('body-van-ribbed','stage-electrical',10),('body-van-ribbed','stage-finish',11),
('body-van-flat','stage-supply',1),('body-van-flat','stage-prepaint',2),('body-van-flat','stage-cut',3),('body-van-flat','stage-assembly',4),('body-van-flat','stage-welding',5),('body-van-flat','stage-doors',6),('body-van-flat','stage-paint',7),('body-van-flat','stage-mount',8),('body-van-flat','stage-electrical',9),('body-van-flat','stage-finish',10),
('body-tank-5000','stage-supply',1),('body-tank-5000','stage-prepaint',2),('body-tank-5000','stage-cut',3),('body-tank-5000','stage-assembly',4),('body-tank-5000','stage-welding',5),('body-tank-5000','stage-paint',6),('body-tank-5000','stage-mount',7),('body-tank-5000','stage-electrical',8),('body-tank-5000','stage-finish',9),
('body-mixed-rail','stage-supply',1),('body-mixed-rail','stage-prepaint',2),('body-mixed-rail','stage-cut',3),('body-mixed-rail','stage-assembly',4),('body-mixed-rail','stage-welding',5),('body-mixed-rail','stage-guards',6),('body-mixed-rail','stage-paint',7),('body-mixed-rail','stage-mount',8),('body-mixed-rail','stage-electrical',9),('body-mixed-rail','stage-finish',10)
on conflict (product_id,stage_id) do update set sequence=excluded.sequence;

insert into inventory_items (id,code,category,description,physical,committed,safety,unit,location) values
('inv-paint','MAT-0042','Pinturas','Pintura poliuretano naranja ETRAL',38,32,15,'gal','ALM-PIN'),('inv-steel','MAT-0043','Planchas','Plancha galvanizada 1.9 mm x 1200 x 2400',260,174,40,'und','ALM-PLA'),
('inv-profile','MAT-0044','Perfiles','Tubo cuadrado 1 1/2 pulg. x 2.0 mm',96,72,20,'und','ALM-PER'),('inv-electrode','MAT-0045','Consumibles','Electrodo E7018',420,215,75,'kg','ALM-CON'),
('inv-valve','MAT-0046','Accesorios','Válvula para cisterna 3 pulgadas',12,10,6,'und','ALM-ACC'),('inv-thinner','MAT-0047','Pinturas','Thinner acrílico industrial',54,18,12,'gal','ALM-PIN')
on conflict (id) do update set description=excluded.description,physical=excluded.physical,committed=excluded.committed,safety=excluded.safety,unit=excluded.unit,location=excluded.location;

update inventory_items set service_factor=1.65, demand_std_dev=3.40, lead_time_days=7 where code='MAT-0042';
update inventory_items set service_factor=1.65, demand_std_dev=9.16, lead_time_days=7 where code='MAT-0043';
update inventory_items set service_factor=1.65, demand_std_dev=4.58, lead_time_days=7 where code='MAT-0044';
update inventory_items set service_factor=1.65, demand_std_dev=20.33, lead_time_days=5 where code='MAT-0045';
update inventory_items set service_factor=1.65, demand_std_dev=0.97, lead_time_days=14 where code='MAT-0046';
update inventory_items set service_factor=1.65, demand_std_dev=2.75, lead_time_days=7 where code='MAT-0047';

insert into bom_items (id,body_type_id,stage_id,material_code,piece_code,description,length_mm,quantity) values
('bom-1','body-van-ribbed','stage-cut','MAT-0043','PZA-1101','Panel lateral acanalado',6200,8),('bom-2','body-van-ribbed','stage-assembly','MAT-0044','PZA-1102','Perfil estructural',6000,16),('bom-3','body-van-ribbed','stage-paint','MAT-0042','PZA-1103','Pintura poliuretano',0,12),
('bom-4','body-van-flat','stage-cut','MAT-0043','PZA-1201','Panel lateral liso',6200,6),('bom-5','body-van-flat','stage-paint','MAT-0042','PZA-1203','Pintura poliuretano',0,10),
('bom-6','body-tank-5000','stage-assembly','MAT-0043','PZA-2101','Cilindro rolado',5800,10),('bom-7','body-tank-5000','stage-finish','MAT-0046','PZA-2103','Válvula descarga',0,2),('bom-8','body-tank-5000','stage-welding','MAT-0045','PZA-2104','Consumible de soldadura',0,45),
('bom-9','body-mixed-rail','stage-cut','MAT-0043','PZA-3101','Plancha de baranda',2400,5),('bom-10','body-mixed-rail','stage-assembly','MAT-0044','PZA-3102','Tubos estructurales',6000,12),('bom-11','body-mixed-rail','stage-paint','MAT-0042','PZA-3103','Pintura de acabado',0,8)
on conflict (id) do update set stage_id=excluded.stage_id,material_code=excluded.material_code,description=excluded.description,quantity=excluded.quantity;

insert into ceco_orders (id,ceco,customer,body_type_id,progress,line,status,stage_id,plant_state,priority,due_date) values
('order-260180','260180','Andes Cargo','body-van-ribbed',68,'Línea 1','green','stage-paint','En proceso',1,'2026-07-16'),
('order-260181','260181','Sur Express','body-van-flat',18,'Línea 2','orange','stage-prepaint','En cola',3,'2026-07-18'),
('order-260182','260182','Pacífico Oil','body-tank-5000',42,'Línea 3','green','stage-welding','En proceso',2,'2026-07-21'),
('order-260183','260183','Norte Farma','body-van-ribbed',37,'Línea 1','red','stage-assembly','Bloqueado por material',4,'2026-07-23'),
('order-260184','260184','Minerales SAC','body-mixed-rail',31,'Línea 3','orange','stage-cut','En proceso',5,'2026-07-25')
on conflict (id) do update set progress=excluded.progress,status=excluded.status,stage_id=excluded.stage_id,plant_state=excluded.plant_state,due_date=excluded.due_date;

insert into stage_inventory (id,stage_id,ceco,item,quantity,unit,status) values
('wip-1','stage-paint','260180','Carrocería lista para acabado',1,'und','processing'),('wip-2','stage-prepaint','260181','Componentes preparados',26,'pzas','waiting'),
('wip-3','stage-welding','260182','Conjunto de cisterna',1,'und','processing'),('wip-4','stage-assembly','260183','Estructura parcial',1,'und','blocked'),('wip-5','stage-cut','260184','Piezas cortadas',18,'pzas','processing')
on conflict (id) do update set stage_id=excluded.stage_id,item=excluded.item,quantity=excluded.quantity,status=excluded.status;

insert into ceco_activity_progress (id,ceco,activity_id,status,progress,started_at,finished_at) values
('cap-180-1','260180','act-paint-1','completed',100,'2026-07-12 08:10','2026-07-12 09:05'),
('cap-180-2','260180','act-paint-2','completed',100,'2026-07-12 09:15','2026-07-12 11:20'),
('cap-180-3','260180','act-paint-3','in_progress',65,'2026-07-12 11:30',null),
('cap-181-1','260181','act-prepaint-1','completed',100,'2026-07-12 07:50','2026-07-12 08:25'),
('cap-181-2','260181','act-prepaint-2','in_progress',40,'2026-07-12 08:35',null),
('cap-182-1','260182','act-welding-1','completed',100,'2026-07-11 08:00','2026-07-11 09:10'),
('cap-182-2','260182','act-welding-2','completed',100,'2026-07-11 09:20','2026-07-11 13:00'),
('cap-182-3','260182','act-welding-3','in_progress',55,'2026-07-12 08:05',null),
('cap-183-1','260183','act-assembly-1','completed',100,'2026-07-10 08:00','2026-07-10 12:10'),
('cap-183-2','260183','act-assembly-2','blocked',25,'2026-07-11 08:15',null),
('cap-184-1','260184','act-cut-1','completed',100,'2026-07-12 07:45','2026-07-12 08:35'),
('cap-184-2','260184','act-cut-2','in_progress',70,'2026-07-12 08:45',null)
on conflict (id) do update set status=excluded.status,progress=excluded.progress,started_at=excluded.started_at,finished_at=excluded.finished_at;

insert into inventory_movements (id,type,code,ceco,quantity,timestamp,note) values
('mov-1','ingreso','MAT-0042','',50,'2026-07-09 08:10','Compra inicial pintura'),('mov-2','reserva','MAT-0042','260180',12,'2026-07-09 09:20','Reserva MRP por BOM'),
('mov-3','salida','MAT-0042','260180',12,'2026-07-10 08:35','Entrega de almacén a planta'),('mov-4','consumo','MAT-0045','260182',20,'2026-07-10 15:40','Uso reportado en soldado')
on conflict (id) do nothing;

insert into operation_logs (id,date,ceco,worker,activity,total_hours) values
('op-1','2026-07-12','260180','Luis Medina','Aplicación de pintura final',7.5),
('op-2','2026-07-12','260182','Rosa Paredes','Soldeo de estructura',8),
('op-3','2026-07-12','260184','Marco Rojas','Corte de componentes',6.5),
('op-4','2026-07-11','260181','Ana Reyes','Pre-pintado',4)
on conflict (id) do nothing;

insert into quality_checks (id,ceco,stage_id,inspector,approval,observations) values
('qa-1','260180','stage-paint','Claudia Soto','approved','Espesor conforme.'),
('qa-2','260182','stage-welding','Jorge Díaz','observed','Revisar cordón en soporte.'),
('qa-3','260183','stage-assembly','Claudia Soto','pending','Bloqueado por material.')
on conflict (id) do nothing;
