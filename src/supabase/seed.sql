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

-- Refuerzo de datos para tesis: histórico real de CECO 2026 + operación posterior con MRP.
insert into body_types (id,code,family,name,target_days,output_unit) values
('body-rail-telera','PROD-BTE','Barandas','Baranda Telera',13,'und'),
('body-platform','PROD-PLA','Plataformas','Plataforma y cortaviento',18,'und'),
('body-service-maint','SERV-MAN','Servicios','Mantenimiento de carrocería',5,'serv'),
('body-eco-box','PROD-ECO','Especiales','Caja ecológica semicircular',22,'und')
on conflict (id) do update set code=excluded.code,family=excluded.family,name=excluded.name,target_days=excluded.target_days,output_unit=excluded.output_unit;

insert into product_routes (product_id,stage_id,sequence) values
('body-rail-telera','stage-supply',1),('body-rail-telera','stage-prepaint',2),('body-rail-telera','stage-cut',3),('body-rail-telera','stage-assembly',4),('body-rail-telera','stage-paint',5),('body-rail-telera','stage-mount',6),('body-rail-telera','stage-delivery',7),
('body-platform','stage-supply',1),('body-platform','stage-cut',2),('body-platform','stage-assembly',3),('body-platform','stage-paint',4),('body-platform','stage-mount',5),('body-platform','stage-systems',6),('body-platform','stage-delivery',7),
('body-service-maint','stage-supply',1),('body-service-maint','stage-paint',2),('body-service-maint','stage-systems',3),('body-service-maint','stage-delivery',4),
('body-eco-box','stage-supply',1),('body-eco-box','stage-cut',2),('body-eco-box','stage-assembly',3),('body-eco-box','stage-paint',4),('body-eco-box','stage-systems',5),('body-eco-box','stage-delivery',6)
on conflict (product_id,stage_id) do update set sequence=excluded.sequence;

insert into inventory_items (id,code,category,category_id,brand_id,unit_id,description,physical,committed,safety,service_factor,demand_std_dev,lead_time_days,unit,location) values
('inv-0115','MAT-0115','Pinturas','cat-paint','brand-aurora','unit-gal','Base epóxica Aurora',14,4,5,1.65,1.50,7,'gal','ALM-PIN'),
('inv-0116','MAT-0116','Pinturas','cat-paint','brand-generic','unit-kg','Waype de limpieza',58,11,12,1.65,3.20,5,'kg','ALM-CON'),
('inv-0117','MAT-0117','Fijaciones','cat-fastener','brand-generic','unit-und','Gancho lateral tipo C para interior de carrocería',140,38,34,1.65,18.00,5,'und','ALM-FIJ'),
('inv-0118','MAT-0118','Herramientas y consumibles','cat-welding','brand-generic','unit-und','Tiza calderera',28,6,6,1.65,1.40,4,'und','ALM-HER'),
('inv-0119','MAT-0119','Planchas','cat-steel','brand-generic','unit-und','Refuerzo frontal tipo 2',32,10,8,1.65,2.20,9,'und','ALM-PLA'),
('inv-0120','MAT-0120','Fijaciones','cat-fastener','brand-generic','unit-und','Anclaje de carrocería',190,54,45,1.65,16.00,5,'und','ALM-FIJ'),
('inv-0121','MAT-0121','Soldadura','cat-welding','brand-generic','unit-roll','Alambre MIG MAG de 1 mm',18,6,5,1.65,1.40,7,'rollo','ALM-SOL'),
('inv-0122','MAT-0122','Fijaciones','cat-fastener','brand-generic','unit-und','Bisagra BP-006',62,18,14,1.65,5.60,4,'und','ALM-ACC'),
('inv-0123','MAT-0123','Fijaciones','cat-fastener','brand-generic','unit-und','Bisagra BL-002',74,24,18,1.65,6.50,4,'und','ALM-ACC'),
('inv-0124','MAT-0124','Sistema eléctrico','cat-electric','brand-generic','unit-und','Guardafango tipo 2',24,8,6,1.65,2.00,7,'und','ALM-ACC'),
('inv-0125','MAT-0125','Fijaciones','cat-fastener','brand-generic','unit-m','Jebe de hermeticidad 1 1/2 pulg.',210,52,42,1.65,15.00,5,'m','ALM-REV'),
('inv-0126','MAT-0126','Fijaciones','cat-fastener','brand-generic','unit-und','Autoperforante #10 x 3/4 pulg.',980,240,230,1.65,62.00,5,'und','ALM-FIJ'),
('inv-0127','MAT-0127','Pinturas','cat-paint','brand-3m','unit-und','Pegamento 3M',22,5,6,1.65,1.70,7,'und','ALM-PIN'),
('inv-0128','MAT-0128','Soldadura','cat-welding','brand-generic','unit-kg','Soldadura Cellocord 6011',86,20,20,1.65,7.00,5,'kg','ALM-SOL')
on conflict (id) do update set category=excluded.category,category_id=excluded.category_id,brand_id=excluded.brand_id,unit_id=excluded.unit_id,description=excluded.description,physical=excluded.physical,committed=excluded.committed,safety=excluded.safety,service_factor=excluded.service_factor,demand_std_dev=excluded.demand_std_dev,lead_time_days=excluded.lead_time_days,unit=excluded.unit,location=excluded.location;

insert into bom_items (id,body_type_id,stage_id,material_code,piece_code,description,length_mm,quantity) values
('bom-13','body-van-ribbed','stage-doors','MAT-0122','PZA-1105','Bisagras BP-006 para puertas',0,6),('bom-14','body-van-ribbed','stage-doors','MAT-0123','PZA-1106','Bisagras BL-002 para hoja posterior',0,9),('bom-15','body-van-ribbed','stage-systems','MAT-0125','PZA-1107','Jebe de hermeticidad de puertas',0,13),('bom-16','body-van-ribbed','stage-systems','MAT-0126','PZA-1108','Autoperforantes para terminaciones',0,240),
('bom-17','body-van-flat','stage-prepaint','MAT-0115','PZA-1204','Base epóxica de imprimación',0,2),('bom-18','body-van-flat','stage-doors','MAT-0108','PZA-1205','Kit de cierre posterior',0,4),
('bom-19','body-mixed-rail','stage-assembly','MAT-0117','PZA-3104','Ganchos laterales tipo C',0,38),('bom-20','body-mixed-rail','stage-mount','MAT-0120','PZA-3105','Anclajes de carrocería',0,18),
('bom-21','body-rail-telera','stage-cut','MAT-0044','PZA-4101','Perfiles para baranda telera',6000,14),('bom-22','body-rail-telera','stage-assembly','MAT-0121','PZA-4102','Alambre MIG MAG para ensamble',0,1),('bom-23','body-rail-telera','stage-paint','MAT-0102','PZA-4103','Base zincromato Anypsa X3',0,2),
('bom-24','body-platform','stage-cut','MAT-0043','PZA-5101','Planchas para plataforma',6200,10),('bom-25','body-platform','stage-assembly','MAT-0119','PZA-5102','Refuerzos frontales tipo 2',0,2),('bom-26','body-platform','stage-systems','MAT-0124','PZA-5103','Guardafangos tipo 2',0,2),
('bom-27','body-service-maint','stage-paint','MAT-0103','PZA-6101','Lijas para fierro #80',0,4),('bom-28','body-service-maint','stage-paint','MAT-0116','PZA-6102','Waype y limpieza de superficie',0,1),('bom-29','body-service-maint','stage-delivery','MAT-0127','PZA-6103','Pegamento 3M para terminaciones',0,1),
('bom-30','body-eco-box','stage-cut','MAT-0043','PZA-7101','Planchas para caja semicircular',6200,12),('bom-31','body-eco-box','stage-assembly','MAT-0128','PZA-7102','Soldadura Cellocord 6011',0,8),('bom-32','body-eco-box','stage-paint','MAT-0113','PZA-7103','Sellador 3M 550',0,2)
on conflict (id) do update set body_type_id=excluded.body_type_id,stage_id=excluded.stage_id,material_code=excluded.material_code,piece_code=excluded.piece_code,description=excluded.description,length_mm=excluded.length_mm,quantity=excluded.quantity;

insert into customers (id,name,document_number,contact_name,phone,email,active) values
('customer-tunesa','TUNESA EXPRES S.A.C','20477167307','Coordinación de flota','','',true),
('customer-lucca','TRANSPORTES LUCCA S.A.C','20611418087','Operaciones','','',true),
('customer-soluciones-ambientales','SOLUCIONES AMBIENTALES PERU E.I.R.L','20496108664','Logística','','',true),
('customer-las-americas','DISTRIBUIDORA DROGUERIA LAS AMERICAS S.A.C','20481555371','Mantenimiento de unidades','','',true),
('customer-salvatierra','JAVIER SALVATIERRA FERREL','18083958','','','',true),
('customer-jucasa','JUCASA SERVICIOS GENERALES E.I.R.L','20529474211','','','',true),
('customer-jam','JAM DISTRIBUCIONES SAC',null,'','','',true),
('customer-luchito','LUCHITO SANDOVAL',null,'','','',true),
('customer-itango','GRUPO ITANGO E.I.R.L','20602564038','','','',true),
('customer-prefabricasas','J.S. PREFABRICASAS CONTRATISTAS S.A.C.','20606298278','','','',true),
('customer-ivan-cruzado','IVAN CRUZADO',null,'','','',true)
on conflict (id) do update set name=excluded.name,document_number=excluded.document_number,contact_name=excluded.contact_name,phone=excluded.phone,email=excluded.email,active=excluded.active;

delete from order_material_reservations where ceco in ('260180','260181','260182','260183','260184');
delete from resource_assignments where ceco in ('260180','260181','260182','260183','260184');
delete from operational_incidents where ceco in ('260180','260181','260182','260183','260184');
delete from stage_inventory where ceco in ('260180','260181','260182','260183','260184');
delete from ceco_activity_progress where ceco in ('260180','260181','260182','260183','260184');
delete from operation_logs where ceco in ('260180','260181','260182','260183','260184');
delete from warehouse_exits where ceco in ('260180','260181','260182','260183','260184');
delete from quality_checks where ceco in ('260180','260181','260182','260183','260184');
delete from ceco_orders where ceco in ('260180','260181','260182','260183','260184');

insert into ceco_orders (id,ceco,customer,customer_id,body_type_id,progress,line,status,stage_id,plant_state,priority,due_date) values
('order-260240','260240','TUNESA EXPRES S.A.C','customer-tunesa','body-van-ribbed',78,'Línea 1','green','stage-paint','En proceso controlado',1,'2026-08-02'),
('order-260250','260250','TRANSPORTES LUCCA S.A.C','customer-lucca','body-rail-telera',64,'Línea 2','green','stage-assembly','En proceso controlado',2,'2026-08-06'),
('order-260260','260260','SOLUCIONES AMBIENTALES PERU E.I.R.L','customer-soluciones-ambientales','body-eco-box',46,'Línea 3','orange','stage-cut','Reserva completa, pendiente de capacidad',3,'2026-08-12'),
('order-260270','260270','DISTRIBUIDORA DROGUERIA LAS AMERICAS S.A.C','customer-las-americas','body-van-ribbed',71,'Línea 1','green','stage-systems','En proceso controlado',4,'2026-08-14'),
('order-260210','260210','JAVIER SALVATIERRA FERREL','customer-salvatierra','body-rail-telera',58,'Línea 2','red','stage-assembly','Backlog histórico sin liberación final',8,'2026-05-15'),
('order-260230','260230','JUCASA SERVICIOS GENERALES E.I.R.L','customer-jucasa','body-mixed-rail',100,'Línea 2','green','stage-delivery','Completado',20,'2026-05-14'),
('order-260220','260220','JAM DISTRIBUCIONES SAC','customer-jam','body-service-maint',100,'Línea 3','green','stage-delivery','Completado en fecha',21,'2026-04-09'),
('order-260200','260200','LUCHITO SANDOVAL','customer-luchito','body-service-maint',100,'Línea 3','green','stage-delivery','Completado con atraso histórico',22,'2026-03-27'),
('order-260100','260100','GRUPO ITANGO E.I.R.L','customer-itango','body-platform',100,'Línea 1','green','stage-delivery','Completado con atraso histórico',23,'2026-03-07'),
('order-260070','260070','J.S. PREFABRICASAS CONTRATISTAS S.A.C.','customer-prefabricasas','body-platform',100,'Línea 1','green','stage-delivery','Completado con atraso histórico',24,'2026-02-23'),
('order-260060','260060','IVAN CRUZADO','customer-ivan-cruzado','body-mixed-rail',100,'Línea 2','green','stage-delivery','Completado antes de fecha',25,'2026-01-28')
on conflict (id) do update set customer=excluded.customer,customer_id=excluded.customer_id,body_type_id=excluded.body_type_id,progress=excluded.progress,line=excluded.line,status=excluded.status,stage_id=excluded.stage_id,plant_state=excluded.plant_state,priority=excluded.priority,due_date=excluded.due_date;

insert into order_material_reservations (id,ceco,bom_item_id,stage_id,material_code,required_quantity,reserved_quantity,issued_quantity,consumed_quantity,status) values
('reservation-260240-bom-1','260240','bom-1','stage-cut','MAT-0043',8,8,8,8,'consumed'),('reservation-260240-bom-2','260240','bom-2','stage-assembly','MAT-0044',16,16,16,14,'issued'),('reservation-260240-bom-3','260240','bom-3','stage-paint','MAT-0042',12,12,6,4,'partial'),('reservation-260240-bom-4','260240','bom-4','stage-prepaint','MAT-0047',3,3,3,3,'consumed'),('reservation-260240-bom-13','260240','bom-13','stage-doors','MAT-0122',6,6,0,0,'reserved'),('reservation-260240-bom-14','260240','bom-14','stage-doors','MAT-0123',9,9,0,0,'reserved'),('reservation-260240-bom-15','260240','bom-15','stage-systems','MAT-0125',13,13,0,0,'reserved'),('reservation-260240-bom-16','260240','bom-16','stage-systems','MAT-0126',240,240,0,0,'reserved'),
('reservation-260250-bom-21','260250','bom-21','stage-cut','MAT-0044',14,14,14,14,'consumed'),('reservation-260250-bom-22','260250','bom-22','stage-assembly','MAT-0121',1,1,1,1,'consumed'),('reservation-260250-bom-23','260250','bom-23','stage-paint','MAT-0102',2,2,0,0,'reserved'),
('reservation-260260-bom-30','260260','bom-30','stage-cut','MAT-0043',12,12,6,0,'partial'),('reservation-260260-bom-31','260260','bom-31','stage-assembly','MAT-0128',8,8,0,0,'reserved'),('reservation-260260-bom-32','260260','bom-32','stage-paint','MAT-0113',2,2,0,0,'reserved'),
('reservation-260270-bom-1','260270','bom-1','stage-cut','MAT-0043',8,8,8,8,'consumed'),('reservation-260270-bom-2','260270','bom-2','stage-assembly','MAT-0044',16,16,16,16,'consumed'),('reservation-260270-bom-15','260270','bom-15','stage-systems','MAT-0125',13,13,13,6,'issued'),('reservation-260270-bom-16','260270','bom-16','stage-systems','MAT-0126',240,240,120,80,'partial'),
('reservation-260210-bom-21','260210','bom-21','stage-cut','MAT-0044',14,8,8,8,'partial'),('reservation-260210-bom-22','260210','bom-22','stage-assembly','MAT-0121',1,1,1,1,'consumed'),('reservation-260210-bom-23','260210','bom-23','stage-paint','MAT-0102',2,0,0,0,'pending')
on conflict (id) do update set ceco=excluded.ceco,bom_item_id=excluded.bom_item_id,stage_id=excluded.stage_id,material_code=excluded.material_code,required_quantity=excluded.required_quantity,reserved_quantity=excluded.reserved_quantity,issued_quantity=excluded.issued_quantity,consumed_quantity=excluded.consumed_quantity,status=excluded.status;

insert into stage_inventory (id,stage_id,ceco,item,quantity,unit,status) values
('wip-1','stage-paint','260240','Furgón acanalado sellado',1,'und','processing'),('wip-2','stage-assembly','260250','Baranda telera en soldadura',1,'und','processing'),('wip-3','stage-cut','260260','Piezas de caja semicircular',22,'pzas','processing'),('wip-4','stage-systems','260270','Accesorios eléctricos y cierres',1,'set','processing'),('wip-5','stage-assembly','260210','Estructura telera incompleta',1,'und','blocked')
on conflict (id) do update set stage_id=excluded.stage_id,ceco=excluded.ceco,item=excluded.item,quantity=excluded.quantity,unit=excluded.unit,status=excluded.status;

insert into ceco_activity_progress (id,ceco,activity_id,status,progress,started_at,finished_at) values
('cap-240-1','260240','act-paint-1','completed',100,'2026-07-23 08:10','2026-07-23 09:05'),('cap-240-2','260240','act-paint-2','completed',100,'2026-07-23 09:15','2026-07-23 11:20'),('cap-240-3','260240','act-paint-3','completed',100,'2026-07-24 08:00','2026-07-24 10:10'),('cap-240-4','260240','act-paint-4','completed',100,'2026-07-24 10:20','2026-07-24 12:05'),('cap-240-5','260240','act-paint-5','in_progress',65,'2026-07-25 08:10',null),
('cap-250-1','260250','act-assembly-1','completed',100,'2026-07-22 08:00','2026-07-22 10:00'),('cap-250-2','260250','act-assembly-2','completed',100,'2026-07-22 10:15','2026-07-22 12:00'),('cap-250-3','260250','act-assembly-3','in_progress',70,'2026-07-24 08:00',null),
('cap-260-1','260260','act-cut-1','completed',100,'2026-07-25 07:45','2026-07-25 08:30'),('cap-260-2','260260','act-cut-2','in_progress',55,'2026-07-25 08:45',null),
('cap-270-1','260270','act-systems-1','completed',100,'2026-07-23 08:00','2026-07-23 10:00'),('cap-270-2','260270','act-systems-2','completed',100,'2026-07-23 10:15','2026-07-23 12:15'),('cap-270-3','260270','act-systems-3','completed',100,'2026-07-24 08:15','2026-07-24 09:30'),('cap-270-4','260270','act-systems-4','in_progress',45,'2026-07-25 09:00',null),
('cap-210-1','260210','act-assembly-1','completed',100,'2026-04-02 08:00','2026-04-02 10:30'),('cap-210-2','260210','act-assembly-2','blocked',25,'2026-04-03 08:00',null)
on conflict (id) do update set ceco=excluded.ceco,activity_id=excluded.activity_id,status=excluded.status,progress=excluded.progress,started_at=excluded.started_at,finished_at=excluded.finished_at;

insert into operation_logs (id,date,ceco,worker,activity,total_hours) values
('op-1','2026-07-24','260240','Ana Reyes','Aplicación de sellador',6.5),('op-2','2026-07-24','260250','Luis Medina','Soldeo de carrocería telera',8),('op-3','2026-07-25','260260','Marco Rojas','Corte de planchas para caja semicircular',6),('op-4','2026-07-25','260270','Jorge Díaz','Verificación de accesorios eléctricos',4),('op-5','2026-04-09','260220','Claudia Soto','Entrega documentada según fecha real',2),('op-6','2026-04-02','260200','Ana Reyes','Cierre de mantenimiento con atraso histórico',3),('op-7','2026-04-03','260100','Luis Medina','Liberación de plataforma reprogramada',5)
on conflict (id) do update set date=excluded.date,ceco=excluded.ceco,worker=excluded.worker,activity=excluded.activity,total_hours=excluded.total_hours;

insert into warehouse_exits (id,ticket,ceco,material_code,quantity,timestamp) values
('wh-1','SAL-7001','260240','MAT-0043',8,'2026-07-20 08:35'),('wh-2','SAL-7002','260240','MAT-0044',16,'2026-07-20 09:10'),('wh-3','SAL-7003','260250','MAT-0044',14,'2026-07-21 10:20'),('wh-4','SAL-7004','260270','MAT-0125',13,'2026-07-23 11:15'),('wh-5','SAL-7005','260220','MAT-0103',4,'2026-04-09 08:30')
on conflict (id) do update set ticket=excluded.ticket,ceco=excluded.ceco,material_code=excluded.material_code,quantity=excluded.quantity,timestamp=excluded.timestamp;

insert into inventory_movements (id,type,code,ceco,quantity,timestamp,note) values
('mov-1','ingreso','MAT-0043','',80,'2026-07-18 08:10','Reposición planificada por MRP para lote agosto'),('mov-2','ingreso','MAT-0044','',60,'2026-07-18 08:30','Reposición de perfiles críticos'),('mov-3','reserva','MAT-0043','260240',8,'2026-07-19 09:20','Reserva automática por BOM'),('mov-4','reserva','MAT-0044','260250',14,'2026-07-19 09:45','Reserva automática por BOM'),('mov-5','salida','MAT-0043','260240',8,'2026-07-20 08:35','Entrega de almacén a planta · SAL-7001'),('mov-6','salida','MAT-0044','260250',14,'2026-07-21 10:20','Entrega de almacén a planta · SAL-7003'),('mov-7','consumo','MAT-0121','260250',1,'2026-07-24 16:10','Uso reportado en soldado telera'),('mov-8','ajuste','MAT-0044','260210',6,'2026-07-26 11:40','Regularización de faltante heredado antes del MRP')
on conflict (id) do update set type=excluded.type,code=excluded.code,ceco=excluded.ceco,quantity=excluded.quantity,timestamp=excluded.timestamp,note=excluded.note;

insert into quality_checks (id,ceco,stage_id,inspector,approval,observations) values
('qa-1','260240','stage-paint','Claudia Soto','approved','Sellado liberado; continúa dentro de fecha pactada.'),('qa-2','260250','stage-assembly','Jorge Díaz','approved','Cordones conformes en muestra de baranda telera.'),('qa-3','260260','stage-cut','Claudia Soto','pending','Pendiente de verificación dimensional final.'),('qa-4','260220','stage-delivery','Jorge Díaz','approved','Entrega 2026-04-09 según fecha real registrada.'),('qa-5','260200','stage-delivery','Claudia Soto','approved','Entrega real 2026-04-02; atraso histórico frente a pactada 2026-03-27.'),('qa-6','260100','stage-delivery','Jorge Díaz','approved','Entrega real 2026-04-03; caso usado como línea base antes del control de reservas.')
on conflict (id) do update set ceco=excluded.ceco,stage_id=excluded.stage_id,inspector=excluded.inspector,approval=excluded.approval,observations=excluded.observations;

insert into equipment (id,code,name,stage_id,status,capacity_hours,maintenance_due) values
('equipment-cut-01','EQ-COR-01','Cizalla hidráulica','stage-cut','operational',44,'2026-08-10'),('equipment-weld-01','EQ-SOL-01','Soldadora MIG','stage-assembly','operational',50,'2026-08-07'),('equipment-paint-01','EQ-PIN-01','Cabina de pintura','stage-paint','operational',36,'2026-08-12'),('equipment-lift-01','EQ-MON-01','Puente grúa','stage-mount','operational',38,'2026-08-18')
on conflict (id) do update set code=excluded.code,name=excluded.name,stage_id=excluded.stage_id,status=excluded.status,capacity_hours=excluded.capacity_hours,maintenance_due=excluded.maintenance_due;

insert into work_calendar (id,calendar_date,day_type,available_hours,note) values
('calendar-2026-07-27','2026-07-27','working',8,'Jornada regular con secuencia MRP'),('calendar-2026-07-28','2026-07-28','working',8,'Liberaciones de calidad programadas'),('calendar-2026-07-29','2026-07-29','working',8,'Jornada regular'),('calendar-2026-07-30','2026-07-30','working',8,'Ventana de entregas a planta'),('calendar-2026-07-31','2026-07-31','reduced',6,'Mantenimiento preventivo planificado'),('calendar-2026-08-03','2026-08-03','working',8,'Inicio de lote posterior')
on conflict (id) do update set calendar_date=excluded.calendar_date,day_type=excluded.day_type,available_hours=excluded.available_hours,note=excluded.note;

insert into resource_assignments (id,personnel_id,ceco,activity_id,assigned_date,planned_hours,status) values
('assignment-001','person-004','260240','act-paint-5','2026-07-27',7,'planned'),('assignment-002','person-001','260250','act-assembly-3','2026-07-27',8,'in_progress'),('assignment-003','person-003','260260','act-cut-2','2026-07-27',6,'in_progress'),('assignment-004','person-005','260270','act-systems-4','2026-07-28',4,'planned'),('assignment-005','person-002','260210','act-assembly-2','2026-07-28',6,'blocked')
on conflict (id) do update set personnel_id=excluded.personnel_id,ceco=excluded.ceco,activity_id=excluded.activity_id,assigned_date=excluded.assigned_date,planned_hours=excluded.planned_hours,status=excluded.status;

insert into operational_incidents (id,occurred_at,type,severity,stage_id,ceco,equipment_id,downtime_hours,description,status) values
('incident-001','2026-03-28 10:10','material','high','stage-assembly','260100',null,18,'Falta de anclajes y refuerzos obligó a reprogramar la plataforma.','resolved'),('incident-002','2026-07-25 09:20','quality','low','stage-paint','260240',null,1,'Observación menor corregida antes de liberar pintura.','resolved'),('incident-003','2026-07-26 11:40','material','medium','stage-assembly','260210',null,4,'Backlog anterior al control MRP con reserva parcial de perfiles.','investigating')
on conflict (id) do update set occurred_at=excluded.occurred_at,type=excluded.type,severity=excluded.severity,stage_id=excluded.stage_id,ceco=excluded.ceco,equipment_id=excluded.equipment_id,downtime_hours=excluded.downtime_hours,description=excluded.description,status=excluded.status;
