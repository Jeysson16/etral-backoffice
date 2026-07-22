-- Datos de demostración alineados con DOP DE FURGÓN ACANALADO y AVANCE DE CECOS.
insert into material_categories (id,name,description) values
('cat-steel','Planchas y perfiles','Acero, tubos, planchas y piezas estructurales'),('cat-paint','Pinturas y preparación','Pinturas, selladores, thinner y lijas'),('cat-welding','Soldadura','Alambres, electrodos, gases y consumibles'),('cat-fastener','Fijaciones y herrajes','Pernos, tuercas, bisagras y kit de cierre'),('cat-electric','Sistema eléctrico','Cableado, faros, terminales y accesorios eléctricos'),('cat-wood','Madera y revestimiento','Listones, paneles y revestimientos')
on conflict (id) do update set name=excluded.name, description=excluded.description;
insert into measurement_units (id,name,symbol) values ('unit-und','Unidad','und'),('unit-gal','Galón','gal'),('unit-kg','Kilogramo','kg'),('unit-m','Metro','m'),('unit-roll','Rollo','rollo'),('unit-cylinder','Balón','balón') on conflict (id) do update set name=excluded.name, symbol=excluded.symbol;
insert into brands (id,name) values ('brand-anypsa','Anypsa'),('brand-3m','3M'),('brand-aurora','Aurora'),('brand-fene','Fene'),('brand-etral','ETRAL'),('brand-generic','Genérico') on conflict (id) do update set name=excluded.name;
insert into activity_types (code,name,diagram_symbol) values ('operation','Operación','círculo'),('inspection','Inspección','cuadrado'),('transport','Transporte','flecha'),('delay','Demora','semicírculo'),('storage','Almacén','triángulo') on conflict (code) do update set name=excluded.name, diagram_symbol=excluded.diagram_symbol;

insert into flow_stages (id,code,"order",name,short_name,capacity_hours,standard_hours,color,gated_by_quality) values
('stage-supply','SUP',0,'Abastecimiento de materiales','01',40,4,'#64748b',false),('stage-prepaint','PRE',1,'Prepintado de componentes','02',36,6,'#0ea5e9',true),('stage-cut','CUT',2,'Corte de componentes','03',44,7,'#2563eb',true),('stage-assembly','ASM',3,'Armado de furgón acanalado','04',52,14,'#16a34a',false),('stage-paint','PNT',4,'Preparación de pintado general','05',34,16,'#f97316',true),('stage-doors','DRS',5,'Armado e instalación de puertas','06',32,12,'#8b5cf6',true),('stage-mount','MNT',6,'Montaje de furgón sobre chasis','07',30,8,'#d97706',true),('stage-systems','SYS',7,'Instalación de sistemas y accesorios','08',30,6,'#eab308',true),('stage-delivery','DEL',8,'Verificación y entrega','09',38,4,'#0f766e',true)
on conflict (id) do update set code=excluded.code,"order"=excluded."order",name=excluded.name,short_name=excluded.short_name,capacity_hours=excluded.capacity_hours,standard_hours=excluded.standard_hours,color=excluded.color,gated_by_quality=excluded.gated_by_quality;

insert into stage_activities (id,stage_id,sequence,name,standard_minutes,active,activity_type_code) values
('act-supply-1','stage-supply',1,'Adquisición de planchas y perfiles metálicos',60,true,'operation'),('act-supply-2','stage-supply',2,'Recepción de materiales',75,true,'operation'),('act-supply-3','stage-supply',3,'Transporte interno al área de corte',45,true,'transport'),
('act-prepaint-1','stage-prepaint',1,'Lijado de piezas',60,true,'operation'),('act-prepaint-2','stage-prepaint',2,'Aplicación de acondicionador de metal',75,true,'operation'),('act-prepaint-3','stage-prepaint',3,'Pre-pintado',90,true,'operation'),('act-prepaint-4','stage-prepaint',4,'Secado de prepintado de componentes',120,true,'delay'),
('act-cut-1','stage-cut',1,'Inspección de medidas y piezas para corte',45,true,'inspection'),('act-cut-2','stage-cut',2,'Corte de planchas y perfiles',120,true,'operation'),
('act-assembly-1','stage-assembly',1,'Soldeo de falso chasis',120,true,'operation'),('act-assembly-2','stage-assembly',2,'Resoldeo de falso chasis',90,true,'operation'),('act-assembly-3','stage-assembly',3,'Soldeo de carrocería',180,true,'operation'),('act-assembly-4','stage-assembly',4,'Resoldeo de carrocería',120,true,'operation'),('act-assembly-5','stage-assembly',5,'Instalación de kit de cierre',90,true,'operation'),
('act-paint-1','stage-paint',1,'Esmerilado de soldaduras',90,true,'operation'),('act-paint-2','stage-paint',2,'Masillado',90,true,'operation'),('act-paint-3','stage-paint',3,'Lijado y pulido',120,true,'operation'),('act-paint-4','stage-paint',4,'Aplicación de sellador',75,true,'operation'),('act-paint-5','stage-paint',5,'Instalación de techo',120,true,'operation'),('act-paint-6','stage-paint',6,'Aplicación de pintura final de la estructura',150,true,'operation'),
('act-doors-1','stage-doors',1,'Preparación de piezas',60,true,'operation'),('act-doors-2','stage-doors',2,'Prepintado',75,true,'operation'),('act-doors-3','stage-doors',3,'Soldado de subensamble',120,true,'operation'),('act-doors-4','stage-doors',4,'Lijado',60,true,'operation'),('act-doors-5','stage-doors',5,'Macillado',75,true,'operation'),('act-doors-6','stage-doors',6,'Pulido',60,true,'operation'),('act-doors-7','stage-doors',7,'Aplicación de sellador',60,true,'operation'),('act-doors-8','stage-doors',8,'Pintado de puertas',120,true,'operation'),('act-doors-9','stage-doors',9,'Instalación de jebes de puerta',60,true,'operation'),('act-doors-10','stage-doors',10,'Colocación de pernos y tuercas',60,true,'operation'),('act-doors-11','stage-doors',11,'Instalación de seguros de puerta',60,true,'operation'),('act-doors-12','stage-doors',12,'Instalación de puertas',90,true,'operation'),
('act-mount-1','stage-mount',1,'Ubicación de furgón para el montaje',60,true,'operation'),('act-mount-2','stage-mount',2,'Instalación de listones de madera',120,true,'operation'),('act-mount-3','stage-mount',3,'Inspección de listones de madera',30,true,'inspection'),('act-mount-4','stage-mount',4,'Montaje de furgón',180,true,'operation'),('act-mount-5','stage-mount',5,'Instalación de abrazaderas',90,true,'operation'),('act-mount-6','stage-mount',6,'Inspección de abrazaderas',30,true,'inspection'),
('act-systems-1','stage-systems',1,'Instalación de sistema eléctrico',120,true,'operation'),('act-systems-2','stage-systems',2,'Instalación de defensas y guardafangos',120,true,'operation'),('act-systems-3','stage-systems',3,'Instalación de parachoque',75,true,'operation'),('act-systems-4','stage-systems',4,'Instalación de porta extintor',45,true,'operation'),('act-systems-5','stage-systems',5,'Instalación de porta cono',45,true,'operation'),('act-systems-6','stage-systems',6,'Instalación de porta taco',45,true,'operation'),
('act-delivery-1','stage-delivery',1,'Verificar',30,true,'inspection'),('act-delivery-2','stage-delivery',2,'Almacenamiento / entrega del producto',30,true,'storage')
on conflict (id) do update set name=excluded.name,standard_minutes=excluded.standard_minutes,activity_type_code=excluded.activity_type_code,active=excluded.active;

insert into body_types (id,code,family,name,target_days,output_unit) values
('body-van-ribbed','PROD-FAC','Furgones','Furgón Acanalado',16,'und'),('body-van-flat','PROD-FLI','Furgones','Furgón Liso',14,'und'),
('body-tank-5000','PROD-CIS','Cisternas','Cisterna 5000G',20,'und'),('body-mixed-rail','PROD-BMI','Barandas','Baranda Mixta',12,'und')
on conflict (id) do update set code=excluded.code,family=excluded.family,name=excluded.name,target_days=excluded.target_days,output_unit=excluded.output_unit;

insert into product_routes (product_id,stage_id,sequence) values
('body-van-ribbed','stage-supply',1),('body-van-ribbed','stage-prepaint',2),('body-van-ribbed','stage-cut',3),('body-van-ribbed','stage-assembly',4),('body-van-ribbed','stage-paint',5),('body-van-ribbed','stage-doors',6),('body-van-ribbed','stage-mount',7),('body-van-ribbed','stage-systems',8),('body-van-ribbed','stage-delivery',9),
('body-van-flat','stage-supply',1),('body-van-flat','stage-prepaint',2),('body-van-flat','stage-cut',3),('body-van-flat','stage-assembly',4),('body-van-flat','stage-paint',5),('body-van-flat','stage-doors',6),('body-van-flat','stage-mount',7),('body-van-flat','stage-systems',8),('body-van-flat','stage-delivery',9),
('body-tank-5000','stage-supply',1),('body-tank-5000','stage-cut',2),('body-tank-5000','stage-assembly',3),('body-tank-5000','stage-paint',4),('body-tank-5000','stage-mount',5),('body-tank-5000','stage-systems',6),('body-tank-5000','stage-delivery',7),
('body-mixed-rail','stage-supply',1),('body-mixed-rail','stage-prepaint',2),('body-mixed-rail','stage-cut',3),('body-mixed-rail','stage-assembly',4),('body-mixed-rail','stage-paint',5),('body-mixed-rail','stage-mount',6),('body-mixed-rail','stage-systems',7),('body-mixed-rail','stage-delivery',8)
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
update inventory_items set category_id='cat-paint', unit_id='unit-gal', brand_id='brand-anypsa' where code in ('MAT-0042','MAT-0047');
update inventory_items set category_id='cat-steel', unit_id='unit-und' where code in ('MAT-0043','MAT-0044');
update inventory_items set category_id='cat-welding', unit_id='unit-kg' where code='MAT-0045';
update inventory_items set category_id='cat-fastener', unit_id='unit-und' where code='MAT-0046';

insert into inventory_items (id,code,category,category_id,brand_id,unit_id,description,physical,committed,safety,service_factor,demand_std_dev,lead_time_days,unit,location) values
('inv-0101','MAT-0101','Pinturas','cat-paint','brand-generic','unit-gal','Acondicionador de metales preparado',18,3,4,1.65,1.20,7,'gal','ALM-PIN'),
('inv-0102','MAT-0102','Pinturas','cat-paint','brand-anypsa','unit-gal','Base zincromato Anypsa X3',26,8,6,1.65,1.70,7,'gal','ALM-PIN'),
('inv-0103','MAT-0103','Pinturas','cat-paint','brand-fene','unit-und','Papel lija de fierro gr. 80',95,14,20,1.65,5.00,5,'und','ALM-PIN'),
('inv-0104','MAT-0104','Pinturas','cat-paint','brand-generic','unit-kg','Trapo industrial',42,7,8,1.65,2.10,4,'kg','ALM-CON'),
('inv-0105','MAT-0105','Soldadura','cat-welding','brand-generic','unit-roll','Alambre de soldadura E70XX',24,5,6,1.65,1.40,7,'rollo','ALM-SOL'),
('inv-0106','MAT-0106','Soldadura','cat-welding','brand-generic','unit-cylinder','Argo mix',12,3,3,1.65,0.80,5,'balón','ALM-SOL'),
('inv-0107','MAT-0107','Soldadura','cat-welding','brand-fene','unit-und','Disco de corte Fene 7 pulgadas',64,12,15,1.65,3.40,5,'und','ALM-HER'),
('inv-0108','MAT-0108','Fijaciones','cat-fastener','brand-generic','unit-und','Kit de cierre 134121',16,6,4,1.65,1.10,10,'und','ALM-ACC'),
('inv-0109','MAT-0109','Fijaciones','cat-fastener','brand-generic','unit-und','Perno zincado cabeza de coche 5/16 x 1',620,130,150,1.65,35.00,5,'und','ALM-FIJ'),
('inv-0110','MAT-0110','Fijaciones','cat-fastener','brand-generic','unit-und','Tuerca stop zincada de 5/16',540,120,140,1.65,32.00,5,'und','ALM-FIJ'),
('inv-0111','MAT-0111','Planchas','cat-steel','brand-generic','unit-m','Bobina de aluzinc 18000 mm ancho',160,38,35,1.65,8.00,14,'m','ALM-PLA'),
('inv-0112','MAT-0112','Madera y revestimiento','cat-wood','brand-generic','unit-m','Bobina de fibra de vidrio translúcida 2600 mm ancho',45,9,10,1.65,2.80,12,'m','ALM-REV'),
('inv-0113','MAT-0113','Pinturas','cat-paint','brand-3m','unit-und','Sellador 3M 550 + boquilla',36,8,10,1.65,2.30,7,'und','ALM-PIN'),
('inv-0114','MAT-0114','Sistema eléctrico','cat-electric','brand-generic','unit-und','Base de faro lateral estandarizada',42,12,10,1.65,2.20,7,'und','ALM-ELE')
on conflict (id) do update set category=excluded.category,category_id=excluded.category_id,brand_id=excluded.brand_id,unit_id=excluded.unit_id,description=excluded.description,physical=excluded.physical,committed=excluded.committed,safety=excluded.safety,service_factor=excluded.service_factor,demand_std_dev=excluded.demand_std_dev,lead_time_days=excluded.lead_time_days,unit=excluded.unit,location=excluded.location;

insert into bom_items (id,body_type_id,stage_id,material_code,piece_code,description,length_mm,quantity) values
('bom-1','body-van-ribbed','stage-cut','MAT-0043','PZA-1101','Panel lateral acanalado',6200,8),('bom-2','body-van-ribbed','stage-assembly','MAT-0044','PZA-1102','Perfil estructural',6000,16),('bom-3','body-van-ribbed','stage-paint','MAT-0042','PZA-1103','Pintura poliuretano',0,12),
('bom-4','body-van-ribbed','stage-prepaint','MAT-0047','PZA-1104','Thinner de preparación',0,3),
('bom-5','body-van-flat','stage-cut','MAT-0043','PZA-1201','Panel lateral liso',6200,6),('bom-6','body-van-flat','stage-paint','MAT-0042','PZA-1203','Pintura poliuretano',0,10),
('bom-7','body-tank-5000','stage-assembly','MAT-0043','PZA-2101','Cilindro rolado',5800,10),('bom-8','body-tank-5000','stage-systems','MAT-0046','PZA-2103','Válvula descarga 3 pulgadas',0,2),('bom-9','body-tank-5000','stage-assembly','MAT-0045','PZA-2104','Consumible de soldadura',0,45),
('bom-10','body-mixed-rail','stage-cut','MAT-0043','PZA-3101','Plancha de baranda',2400,5),('bom-11','body-mixed-rail','stage-assembly','MAT-0044','PZA-3102','Tubos estructurales',6000,12),('bom-12','body-mixed-rail','stage-paint','MAT-0042','PZA-3103','Pintura de acabado',0,8)
on conflict (id) do update set stage_id=excluded.stage_id,material_code=excluded.material_code,description=excluded.description,quantity=excluded.quantity;

insert into ceco_orders (id,ceco,customer,body_type_id,progress,line,status,stage_id,plant_state,priority,due_date) values
('order-260180','260180','Andes Cargo','body-van-ribbed',68,'Línea 1','green','stage-paint','En proceso',1,'2026-07-16'),
('order-260181','260181','Sur Express','body-van-flat',18,'Línea 2','orange','stage-prepaint','En cola',3,'2026-07-18'),
('order-260182','260182','Pacífico Oil','body-tank-5000',42,'Línea 3','green','stage-assembly','En proceso',2,'2026-07-21'),
('order-260183','260183','Norte Farma','body-van-ribbed',37,'Línea 1','red','stage-assembly','Bloqueado por material',4,'2026-07-23'),
('order-260184','260184','Minerales SAC','body-mixed-rail',31,'Línea 3','orange','stage-cut','En proceso',5,'2026-07-25')
on conflict (id) do update set progress=excluded.progress,status=excluded.status,stage_id=excluded.stage_id,plant_state=excluded.plant_state,due_date=excluded.due_date;

insert into work_shifts (id,code,name,start_time,end_time,break_minutes,active) values
('shift-day','T1','Turno día','07:30','16:30',60,true),
('shift-evening','T2','Turno tarde','16:30','23:30',45,true)
on conflict (id) do update set code=excluded.code,name=excluded.name,start_time=excluded.start_time,end_time=excluded.end_time,break_minutes=excluded.break_minutes,active=excluded.active;

insert into personnel (id,employee_code,name,role,specialty,shift_id,status,efficiency,weekly_hours,active) values
('person-001','ETR-001','Luis Medina','Soldador','Soldadura estructural','shift-day','available',96,48,true),
('person-002','ETR-002','Rosa Paredes','Armadora','Ensamble de carrocería','shift-day','assigned',94,48,true),
('person-003','ETR-003','Marco Rojas','Operador de corte','Corte y trazado','shift-day','assigned',91,48,true),
('person-004','ETR-004','Ana Reyes','Pintora','Preparación y acabado','shift-day','available',93,48,true),
('person-005','ETR-005','Jorge Díaz','Inspector','Control de calidad','shift-evening','available',97,42,true),
('person-006','ETR-006','Claudia Soto','Inspectora','Liberación de producto','shift-day','absent',95,48,true)
on conflict (id) do update set employee_code=excluded.employee_code,name=excluded.name,role=excluded.role,specialty=excluded.specialty,shift_id=excluded.shift_id,status=excluded.status,efficiency=excluded.efficiency,weekly_hours=excluded.weekly_hours,active=excluded.active;

insert into equipment (id,code,name,stage_id,status,capacity_hours,maintenance_due) values
('equipment-cut-01','EQ-COR-01','Cizalla hidráulica','stage-cut','operational',40,'2026-08-05'),
('equipment-weld-01','EQ-SOL-01','Soldadora MIG','stage-assembly','operational',48,'2026-07-30'),
('equipment-paint-01','EQ-PIN-01','Cabina de pintura','stage-paint','restricted',30,'2026-07-24'),
('equipment-lift-01','EQ-MON-01','Puente grúa','stage-mount','operational',36,'2026-08-12')
on conflict (id) do update set code=excluded.code,name=excluded.name,stage_id=excluded.stage_id,status=excluded.status,capacity_hours=excluded.capacity_hours,maintenance_due=excluded.maintenance_due;

insert into work_calendar (id,calendar_date,day_type,available_hours,note) values
('calendar-2026-07-21','2026-07-21','working',8,'Jornada regular'),
('calendar-2026-07-22','2026-07-22','working',8,'Jornada regular'),
('calendar-2026-07-23','2026-07-23','working',8,'Jornada regular'),
('calendar-2026-07-24','2026-07-24','reduced',6,'Mantenimiento general')
on conflict (id) do update set calendar_date=excluded.calendar_date,day_type=excluded.day_type,available_hours=excluded.available_hours,note=excluded.note;

insert into resource_assignments (id,personnel_id,ceco,activity_id,assigned_date,planned_hours,status) values
('assignment-001','person-001','260182','act-assembly-3','2026-07-21',8,'in_progress'),
('assignment-002','person-002','260183','act-assembly-2','2026-07-21',7,'blocked'),
('assignment-003','person-003','260184','act-cut-2','2026-07-21',6,'in_progress'),
('assignment-004','person-004','260180','act-paint-3','2026-07-21',7,'planned')
on conflict (id) do update set personnel_id=excluded.personnel_id,ceco=excluded.ceco,activity_id=excluded.activity_id,assigned_date=excluded.assigned_date,planned_hours=excluded.planned_hours,status=excluded.status;

insert into operational_incidents (id,occurred_at,type,severity,stage_id,ceco,equipment_id,downtime_hours,description,status) values
('incident-001','2026-07-21 09:20','equipment','medium','stage-paint','260180','equipment-paint-01',2,'Presión irregular en cabina de pintura','open'),
('incident-002','2026-07-21 10:10','material','high','stage-assembly','260183',null,4,'Material reservado insuficiente para continuar','investigating')
on conflict (id) do update set occurred_at=excluded.occurred_at,type=excluded.type,severity=excluded.severity,stage_id=excluded.stage_id,ceco=excluded.ceco,equipment_id=excluded.equipment_id,downtime_hours=excluded.downtime_hours,description=excluded.description,status=excluded.status;

insert into stage_inventory (id,stage_id,ceco,item,quantity,unit,status) values
('wip-1','stage-paint','260180','Carrocería lista para acabado',1,'und','processing'),('wip-2','stage-prepaint','260181','Componentes preparados',26,'pzas','waiting'),
('wip-3','stage-assembly','260182','Conjunto de cisterna',1,'und','processing'),('wip-4','stage-assembly','260183','Estructura parcial',1,'und','blocked'),('wip-5','stage-cut','260184','Piezas cortadas',18,'pzas','processing')
on conflict (id) do update set stage_id=excluded.stage_id,item=excluded.item,quantity=excluded.quantity,status=excluded.status;

insert into ceco_activity_progress (id,ceco,activity_id,status,progress,started_at,finished_at) values
('cap-180-1','260180','act-paint-1','completed',100,'2026-07-12 08:10','2026-07-12 09:05'),
('cap-180-2','260180','act-paint-2','completed',100,'2026-07-12 09:15','2026-07-12 11:20'),
('cap-180-3','260180','act-paint-3','in_progress',65,'2026-07-12 11:30',null),
('cap-181-1','260181','act-prepaint-1','completed',100,'2026-07-12 07:50','2026-07-12 08:25'),
('cap-181-2','260181','act-prepaint-2','in_progress',40,'2026-07-12 08:35',null),
('cap-182-1','260182','act-assembly-1','completed',100,'2026-07-11 08:00','2026-07-11 09:10'),
('cap-182-2','260182','act-assembly-2','completed',100,'2026-07-11 09:20','2026-07-11 13:00'),
('cap-182-3','260182','act-assembly-3','in_progress',55,'2026-07-12 08:05',null),
('cap-183-1','260183','act-assembly-1','completed',100,'2026-07-10 08:00','2026-07-10 12:10'),
('cap-183-2','260183','act-assembly-2','blocked',25,'2026-07-11 08:15',null),
('cap-184-1','260184','act-cut-1','completed',100,'2026-07-12 07:45','2026-07-12 08:35'),
('cap-184-2','260184','act-cut-2','in_progress',70,'2026-07-12 08:45',null)
on conflict (id) do update set status=excluded.status,progress=excluded.progress,started_at=excluded.started_at,finished_at=excluded.finished_at;

insert into inventory_movements (id,type,code,ceco,quantity,timestamp,note) values
('mov-1','ingreso','MAT-0042','',50,'2026-07-09 08:10','Compra inicial pintura'),('mov-2','reserva','MAT-0042','260180',12,'2026-07-09 09:20','Reserva MRP por BOM'),
('mov-3','salida','MAT-0042','260180',12,'2026-07-10 08:35','Entrega de almacén a planta'),('mov-4','consumo','MAT-0045','260182',20,'2026-07-10 15:40','Uso reportado en soldado')
on conflict (id) do nothing;

insert into warehouse_exits (id,ticket,ceco,material_code,quantity,timestamp) values
('wh-1','SAL-7001','260180','MAT-0042',12,'2026-07-10 08:35'),
('wh-2','SAL-7002','260182','MAT-0045',80,'2026-07-10 11:20'),
('wh-3','SAL-7003','260184','MAT-0043',24,'2026-07-11 09:10')
on conflict (id) do update set ticket=excluded.ticket,ceco=excluded.ceco,material_code=excluded.material_code,quantity=excluded.quantity,timestamp=excluded.timestamp;

insert into operation_logs (id,date,ceco,worker,activity,total_hours) values
('op-1','2026-07-12','260180','Luis Medina','Aplicación de pintura final',7.5),
('op-2','2026-07-12','260182','Rosa Paredes','Soldeo de estructura',8),
('op-3','2026-07-12','260184','Marco Rojas','Corte de componentes',6.5),
('op-4','2026-07-11','260181','Ana Reyes','Pre-pintado',4)
on conflict (id) do nothing;

insert into quality_checks (id,ceco,stage_id,inspector,approval,observations) values
('qa-1','260180','stage-paint','Claudia Soto','approved','Espesor conforme.'),
('qa-2','260182','stage-assembly','Jorge Díaz','observed','Revisar cordón en soporte.'),
('qa-3','260183','stage-assembly','Claudia Soto','pending','Bloqueado por material.')
on conflict (id) do nothing;
