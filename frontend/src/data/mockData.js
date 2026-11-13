// Datos de la web y del panel (catálogo, sedes, ejemplos)
const TORITO = "https://torito.pe/wp-content/uploads";
export const FOTOS_FAMILIA = {
  cuatroValvulas: `${TORITO}/2026/09/torito-4v-gsl-azul-02-34-frontal-der.png`,
  dosTiempos: `${TORITO}/2025/10/Para-pasajeros-2-T.png`,
  cargaPasajeros: `${TORITO}/2025/10/Para-carga-y-pasajeros.png`,
  cromPlus: `${TORITO}/2025/10/Para-pasajeros-4-T.png`,
  torito250: `${TORITO}/2026/09/torito_titanx_rojo_8-1.png`,
};
// Eventos de Torito Bajaj en el Perú (blog de torito.pe): fotos reales de la comunidad Torito
export const EVENTOS_TORITO = [
  { foto: `${TORITO}/2025/03/67336ee4a0342321917366.jpeg`, titulo: "Curso de Seguridad Vial en Mi Perú" },
  { foto: `${TORITO}/2025/03/673e0421a17b3309949029-scaled.jpeg`, titulo: "Evento de Tuning de Motocarro" },
  { foto: `${TORITO}/2025/03/image-29-min.jpg`, titulo: "Escuela de Ventas Torito Bajaj en Lima Norte" },
  { foto: `${TORITO}/2025/03/672cd2d9704c7145862703.jpg`, titulo: "El Crom Plus en Ilave" },
  { foto: `${TORITO}/2025/03/673208ffe0d70475384436-scaled.jpeg`, titulo: "Gran Campeonato Torito en Puno" },
];

// Catálogo de modelos
export const FAMILIAS = ["Motores 4 Válvulas", "Motores 2 Tiempos", "Motores Crom Plus"];

export const MODELOS = [
  {
    id: "torito-4v-gsl", codmod: "1", nombre: "Torito 4V GSL", familia: "Motores 4 Válvulas",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "Gasolina", uso: "Pasajeros", tipoTecho: "Clásico",
    precioDesde: 17899, badges: ["NUEVO MODELO", "PRECIO DE LANZAMIENTO"],
    imagen: `${TORITO}/2026/09/torito_hrv_azul_34frontal.png`, local: "/images/modelos/modelo-1.png",
    colorFoto: "Azul", colores: ["Azul"],
    descripcion: "El Torito 4V GSL es el motocar a gasolina con motor de 4 válvulas: más potencia y torque para subir pendientes con carga completa, menor consumo y una conducción más estable. Pensado para el conductor que trabaja todos los días y necesita una herramienta confiable.",
    destacados: ["Motor 4 válvulas de 236.2 cc con 10.73 HP", "Torque de 20 Nm para pendientes y carga", "Velocidad máxima de 65 km/h", "Tanque de 8 litros de gasolina"],
    resumen: {"Motor": "4 tiempos, 4 válvulas", "Cilindrada": "236.2 cc", "Llantas": "Aro 8\" sin cámara", "Potencia": "10.73 HP", "Torque": "20 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos, 4 válvulas, gasolina"], ["Cilindrada", "236.2 cc"], ["Diámetro × carrera", "67 mm × 67 mm"], ["Refrigeración", "Forzada por aire y aceite"], ["Transmisión", "Engranaje constante, manual: 4 marchas + 1 reversa"], ["Potencia máxima", "10.73 HP a 5,000 ± 250 RPM"], ["Torque máximo", "20 Nm a 3,500 RPM"]],
      chasis: [["Neumáticos", "4.00-8, 4/6 PR (los cuatro)"], ["Frenos", "Hidráulicos de zapata expansible, delantero y posterior"], ["Freno de estacionamiento", "Mecánico de zapata expansible en ruedas traseras"]],
      consumo: [["Velocidad máxima", "65 km/h"], ["Capacidad de tanque", "8 L (reserva 1.5 L)"]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,350 mm"], ["Alto", "1,710 mm"], ["Peso en vacío", "371 kg"], ["Peso máximo", "681 kg"]],
      electrico: [["Sistema eléctrico", "12 V DC"], ["Batería", "12 V, 32 Ah"], ["Faro delantero", "35/35 W"], ["Luz trasera / freno", "5/21 W o 5/18 W"]],
    },
  },
  {
    id: "torito-4v-glp", codmod: "2", nombre: "Torito 4V GLP", familia: "Motores 4 Válvulas",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "GLP", uso: "Pasajeros", tipoTecho: "Clásico",
    precioDesde: 17899, badges: ["NUEVO MODELO", "PRECIO DE LANZAMIENTO"],
    imagen: `${TORITO}/2026/09/torito_hrv_rojo_34frontal.png`, local: "/images/modelos/modelo-2.png",
    colores: ["Rojo"],
    descripcion: "El Torito 4V GLP combina el motor de 4 válvulas con un sistema dual GLP + gasolina. Ahorra en cada kilómetro con gas y conserva el respaldo de gasolina cuando lo necesites.",
    destacados: ["Sistema dual: tanque de GLP de 20.6 L + 3 L de gasolina", "Motor de 4 válvulas con 10.33 HP", "Torque de 18 Nm", "Ahorro diario frente a la gasolina"],
    resumen: {"Motor": "4 tiempos, 4 válvulas", "Cilindrada": "236.2 cc", "Llantas": "Aro 8\" sin cámara", "Potencia": "10.33 HP", "Torque": "18 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos, 4 válvulas"], ["Combustible", "GLP con respaldo de gasolina"], ["Cilindrada", "236.2 cc"], ["Diámetro × carrera", "67 mm × 67 mm"], ["Refrigeración", "Forzada por aire y aceite"], ["Transmisión", "Engranaje constante, manual: 4 marchas + 1 reversa"], ["Potencia máxima", "10.33 HP a 5,000 ± 250 RPM"], ["Torque máximo", "18 Nm a 3,500 RPM"]],
      chasis: [["Neumáticos", "4.00-8, 4/6 PR (los cuatro)"], ["Frenos", "Hidráulicos de zapata expansible, delantero y posterior"], ["Freno de estacionamiento", "Mecánico de zapata expansible en ruedas traseras"]],
      consumo: [["Velocidad máxima", "65 km/h"], ["Capacidad de tanque", "20.6 L de GLP (16.5 L al 80%) + 3 L de gasolina"]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,350 mm"], ["Alto", "1,710 mm"], ["Peso en vacío", "386 kg"], ["Peso máximo", "696 kg"]],
      electrico: [["Sistema eléctrico", "12 V DC"], ["Batería", "12 V, 32 Ah"], ["Faro delantero", "35/35 W"], ["Luz trasera / freno", "5/21 W o 5/18 W"]],
    },
  },
  {
    id: "torito-4v-gnv", codmod: "9", nombre: "Torito 4V GNV", familia: "Motores 4 Válvulas",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "GNV", uso: "Pasajeros", tipoTecho: "Clásico",
    precioDesde: 17899, badges: ["NUEVO MODELO", "PRECIO DE LANZAMIENTO"],
    imagen: `${TORITO}/2025/04/1-5.png`, local: "/images/modelos/modelo-9.png",
    colores: ["Rojo"],
    descripcion: "Ahorro y tecnología para tu negocio. El Torito 4V GNV es la nueva generación de Torito: motor de 4 válvulas a gas natural, encendido instantáneo ISG, retroceso directo en el manubrio, triple filtrado de aceite y tablero con indicador de diagnóstico.",
    destacados: ["Motor 4 válvulas a GNV de 236.2 cc", "Encendido instantáneo ISG", "Retroceso directo en el manubrio", "Triple filtrado de aceite"],
    resumen: {"Motor": "4 tiempos, 4 válvulas", "Cilindrada": "236.2 cc", "Llantas": "Aro 8\" sin cámara", "Potencia": "9.79 HP", "Torque": "16.5 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos, 4 válvulas, GNV"], ["Cilindrada", "236.2 cc"], ["Diámetro × carrera", "67 mm × 67 mm"], ["Refrigeración", "Forzada por aire y aceite"], ["Transmisión", "Engranaje constante, manual: 4 marchas + 1 reversa"], ["Potencia máxima", "9.79 HP a 5,000 ± 250 RPM"], ["Torque máximo", "16.5 Nm a 3,500 RPM"]],
      chasis: [["Neumáticos", "4.00-8, 4/6 PR, aro 8\" sin cámara"], ["Frenos", "Hidráulicos de zapata expansible, delantero y posterior"], ["Freno de estacionamiento", "Mecánico de zapata expansible en ruedas traseras"]],
      consumo: [["Velocidad máxima", "63 km/h"], ["Capacidad de tanque", "3 L de gasolina + cilindro de GNV"]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,350 mm"], ["Alto", "1,710 mm"], ["Peso en vacío", "397 kg"], ["Peso máximo", "707 kg"]],
      electrico: [["Sistema eléctrico", "12 V DC"], ["Batería", "12 V, 32 Ah"], ["Faro delantero", "35/35 W"], ["Luz trasera / freno", "5/21 W o 5/18 W"]],
    },
  },
  {
    id: "torito-250-4v-glp", codmod: "3", nombre: "Torito 250 4V GLP", familia: "Motores 4 Válvulas",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "GLP", uso: "Pasajeros", tipoTecho: "Especial",
    precioDesde: 18299, badges: ["NUEVO MODELO"],
    imagen: `${TORITO}/2026/09/torito-250-4v-frontal-lateral-izq.png`, local: "/images/modelos/modelo-3.png",
    colores: ["Rojo"],
    descripcion: "El Torito 250 4V GLP lleva el motor de 4 válvulas a GLP con llantas aro 10 y suspensión delantera doble: más estabilidad y comodidad en cualquier ruta, con el ahorro del gas.",
    destacados: ["Llantas 4.00-10, aro 10\" sin cámara", "Suspensión delantera doble", "Motor 4 válvulas: 10.33 HP y 18 Nm", "Tanque de 20.6 L de GLP + 3 L de gasolina"],
    resumen: {"Motor": "4 tiempos, 4 válvulas", "Cilindrada": "236.2 cc", "Llantas": "Aro 10\" sin cámara", "Potencia": "10.33 HP", "Torque": "18 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos, 4 válvulas"], ["Combustible", "GLP con respaldo de gasolina"], ["Cilindrada", "236.2 cc"], ["Diámetro × carrera", "67 mm × 67 mm"], ["Refrigeración", "Forzada por aire y aceite"], ["Transmisión", "Eje cardán (CV), engranaje constante, manual: 4 marchas + 1 reversa"], ["Potencia máxima", "10.33 HP a 5,000 ± 250 RPM"], ["Torque máximo", "18 Nm a 3,500 RPM"]],
      chasis: [["Neumáticos", "4.00-10, 4/10 PR (los cuatro)"], ["Suspensión", "Delantera doble"], ["Frenos", "Hidráulicos de zapata expansible, delantero y posterior"], ["Freno de estacionamiento", "Mecánico de zapata expansible en ruedas traseras"]],
      consumo: [["Velocidad máxima", "65 km/h"], ["Capacidad de tanque", "20.6 L de GLP (16.5 L al 80%) + 3 L de gasolina"]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,350 mm"], ["Alto", "1,710 mm"], ["Peso en vacío", "386 kg"], ["Peso máximo", "696 kg"]],
      electrico: [["Sistema eléctrico", "12 V DC"], ["Batería", "12 V, 32 Ah"], ["Faro delantero", "35/35 W"], ["Luz trasera / freno", "5/21 W o 5/18 W"]],
    },
  },
  {
    id: "torito-2t-ug-glp", codmod: "4", nombre: "Torito 2T UG GLP", familia: "Motores 2 Tiempos",
    estado: "Publicado", tipoMotor: "2 tiempos", combustible: "GLP", uso: "Pasajeros", tipoTecho: "Clásico",
    precioDesde: 14699, badges: [],
    imagen: `${TORITO}/2025/04/8.png`, local: "/images/modelos/modelo-4.png",
    colores: ["Rojo", "Azul", "Amarillo", "Verde", "Negro"],
    fotosColor: { Rojo: `${TORITO}/2025/04/8.png`, Azul: `${TORITO}/2025/04/7-1.png` },
    descripcion: "Motor de 2 tiempos con GLP: la opción más económica para empezar a trabajar. Fácil de mantener, ligero y con bajo costo por kilómetro.",
    destacados: ["Motor de 2 tiempos de 145.45 cc", "8.58 HP y 15 Nm de torque", "Peso de solo 325 kg", "Precio de entrada accesible"],
    resumen: {"Motor": "2 tiempos", "Cilindrada": "145.45 cc", "Llantas": "4-8, aro de una pieza", "Potencia": "8.58 HP", "Torque": "15 Nm"},
    specs: {
      motor: [["Motor", "2 tiempos UG GLP"], ["Cilindrada", "145.45 cc"], ["Diámetro × carrera", "57 mm × 57 mm"], ["Bujía", "1 (Champion RL82C)"], ["Refrigeración", "Forzada por aire"], ["Embrague", "Multidisco húmedo"], ["Transmisión", "Manual, malla constante: 4 marchas + 1 reversa"], ["Potencia máxima", "8.58 HP a 5,000 ± 250 RPM"], ["Torque máximo", "15 Nm a 3,300 ± 250 RPM"]],
      chasis: [["Chasis", "Monocasco"], ["Neumáticos", "4-8, 4-6 PR, aro de una pieza"], ["Frenos", "Tambor de expansión hidráulica, delantero y posterior"], ["Freno de estacionamiento", "Zapata de expansión mecánica"], ["Presión de llantas", "Delantera 36 PSI · posterior 40 PSI"]],
      consumo: [["Velocidad máxima", "60 km/h"], ["Capacidad de tanque", "20.6 L"], ["Capacidad de escalada", "16% (9.1°) máx."]],
      dimensiones: [["Largo", "2,658 mm"], ["Ancho", "1,300 mm"], ["Alto", "1,700 mm"], ["Radio de giro", "2,880 mm"], ["Peso", "325 kg"]],
      electrico: [["Sistema eléctrico", "12 V CC"], ["Batería", "32 Ah (arranque eléctrico)"], ["Bocina", "12 V DC, tipo 2A"]],
    },
  },
  {
    id: "torito-2t-ug-gsl", codmod: "5", nombre: "Torito 2T UG GSL", familia: "Motores 2 Tiempos",
    estado: "Publicado", tipoMotor: "2 tiempos", combustible: "Gasolina", uso: "Pasajeros", tipoTecho: "Clásico",
    precioDesde: 12699, badges: [],
    imagen: `${TORITO}/2025/04/7-1.png`, local: "/images/modelos/modelo-5.png",
    colorPortada: "Azul",
    colores: ["Rojo", "Azul", "Amarillo", "Verde", "Negro"],
    fotosColor: { Rojo: `${TORITO}/2025/04/8.png`, Azul: `${TORITO}/2025/04/7-1.png` },
    descripcion: "El Torito más accesible de la línea. Motor 2 tiempos a gasolina, ideal para comenzar tu negocio de transporte con la menor inversión.",
    destacados: ["El precio más bajo de la línea", "8.44 HP y 17 Nm de torque", "Peso de 340 kg", "Mantenimiento sencillo"],
    resumen: {"Motor": "2 tiempos", "Cilindrada": "145.45 cc", "Llantas": "4-8 sin cámara", "Potencia": "8.44 HP", "Torque": "17 Nm"},
    specs: {
      motor: [["Motor", "2 tiempos UG GSL"], ["Cilindrada", "145.45 cc"], ["Diámetro × carrera", "57 mm × 57 mm"], ["Bujía", "1 (Champion RL82C)"], ["Refrigeración", "Forzada por aire"], ["Embrague", "Multidisco húmedo"], ["Transmisión", "Manual, malla constante: 4 marchas + 1 reversa"], ["Potencia máxima", "8.44 HP a 4,000 ± 250 RPM"], ["Torque máximo", "17 Nm a 3,000 ± 250 RPM"]],
      chasis: [["Chasis", "Monocasco"], ["Neumáticos", "4-8, 4-6 PR (sin cámara)"], ["Frenos", "Tambor de expansión hidráulica, delantero y posterior"], ["Freno de estacionamiento", "Zapata de expansión mecánica"], ["Presión de llantas", "Delantera 36 PSI · posterior 40 PSI"]],
      consumo: [["Velocidad máxima", "60 km/h"], ["Capacidad de tanque", "8 L"], ["Capacidad de escalada", "18% (10.2°) máx."]],
      dimensiones: [["Largo", "2,658 mm"], ["Ancho", "1,300 mm"], ["Alto", "1,700 mm"], ["Radio de giro", "2,880 mm"], ["Peso", "340 kg"]],
      electrico: [["Sistema eléctrico", "12 V CC"], ["Batería", "32 Ah (arranque eléctrico) / 7 Ah (arranque no eléctrico)"], ["Bocina", "12 V DC, tipo 2A"]],
    },
  },
  {
    id: "torito-crom-plus-gnv", codmod: "6", nombre: "Torito Crom Plus GNV", familia: "Motores Crom Plus",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "GNV", uso: "Pasajeros", tipoTecho: "Especial",
    precioDesde: 17199, badges: [],
    imagen: `${TORITO}/2025/10/Para-pasajeros-4-T.png`, local: "/images/modelos/modelo-6.png", sinTinte: true,
    colores: ["Rojo"],
    descripcion: "El Crom Plus GNV es el motocar para quien quiere gastar menos: funciona con gas natural, el combustible más económico por kilómetro.",
    destacados: ["Motor de 198.88 cc", "Tanque de GNV de 30 L (4.5 kg)", "8.78 HP y 14.5 Nm", "El combustible más económico"],
    resumen: {"Motor": "4 tiempos", "Cilindrada": "198.88 cc", "Llantas": "4-8 sin cámara", "Potencia": "8.78 HP", "Torque": "14.5 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos GNV"], ["Cilindrada", "198.88 cc"], ["Diámetro × carrera", "63.5 mm × 62.8 mm"], ["Bujía", "Doble bujía"], ["Refrigeración", "Forzada por aire y aceite"], ["Embrague", "Multidisco húmedo"], ["Transmisión", "Manual, malla constante: 4 marchas + 1 reversa"], ["Potencia máxima", "8.78 HP a 5,000 ± 250 RPM"], ["Torque máximo", "14.5 Nm a 3,500 ± 250 RPM"]],
      chasis: [["Neumáticos", "4.00-8, 6 PR, aro de una pieza"], ["Capacidad de escalada", "19% (10.8°) máx."]],
      consumo: [["Capacidad de tanque", "30 L / 4.5 kg de GNV (reserva 3 L)"]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,300 mm"], ["Alto", "1,710 mm"], ["Peso", "348 kg"]],
      electrico: [["Sistema eléctrico", "12 V CC"], ["Batería", "32 Ah (arranque eléctrico) / 7 Ah (arranque no eléctrico)"], ["Bocina", "12 V DC, tipo 2A"]],
    },
  },
  {
    id: "torito-crom-plus-glp", codmod: "7", nombre: "Torito Crom Plus GLP", familia: "Motores Crom Plus",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "GLP", uso: "Pasajeros", tipoTecho: "Especial",
    precioDesde: 17199, badges: [],
    imagen: `${TORITO}/2025/04/646c02f5bcb15589337055.png`, local: "/images/modelos/modelo-7.png",
    colorFoto: "Azul", colores: ["Azul"],
    descripcion: "Crom Plus con GLP: equilibrio entre potencia y ahorro, con 9.32 HP y 16 Nm para el trabajo diario.",
    destacados: ["9.32 HP y 16 Nm de torque", "Opera con GLP", "Peso de 370 kg", "Excelente relación precio-rendimiento"],
    resumen: {"Motor": "4 tiempos", "Cilindrada": "198.88 cc", "Llantas": "4-8 sin cámara", "Potencia": "9.32 HP", "Torque": "16 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos UG GLP"], ["Cilindrada", "198.88 cc"], ["Diámetro × carrera", "63.5 mm × 62.8 mm"], ["Bujía", "2 (Champion RG6HCC / Bosch UR6CC)"], ["Refrigeración", "Forzada por aire y aceite"], ["Embrague", "Multidisco húmedo (7 discos)"], ["Transmisión", "Engranaje constante, manual: 4 marchas + 1 reversa"], ["Potencia máxima", "9.32 HP a 5,000 ± 250 RPM"], ["Torque máximo", "16 Nm a 3,500 ± 250 RPM"]],
      chasis: [["Chasis", "Monocasco"], ["Neumáticos", "4-8, 4-6 PR (sin cámara)"], ["Frenos", "Tambor de expansión hidráulica, delantero y posterior"], ["Freno de estacionamiento", "Zapata de expansión mecánica"], ["Presión de llantas", "Delantera 36 PSI · posterior 40 PSI"], ["Capacidad de escalada", "16.5% (9.1°) máx."]],
      consumo: [["Velocidad máxima", "65 km/h"], ["Capacidad de tanque", "20.6 L de GLP + 3 L de gasolina"]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,300 mm"], ["Alto", "1,710 mm"], ["Radio de giro", "2,880 mm"], ["Peso", "370 kg"]],
      electrico: [["Sistema eléctrico", "12 V CC"], ["Batería", "32 Ah (arranque eléctrico) / 7 Ah (arranque no eléctrico)"], ["Bocina", "12 V DC, tipo 2A"]],
    },
  },
  {
    id: "torito-crom-plus-gsl", codmod: "8", nombre: "Torito Crom Plus GSL", familia: "Motores Crom Plus",
    estado: "Publicado", tipoMotor: "4 tiempos", combustible: "Gasolina", uso: "Pasajeros", tipoTecho: "Especial",
    precioDesde: 17199, badges: [],
    imagen: `${TORITO}/2025/04/3-2.png`, local: "/images/modelos/modelo-8.png",
    colorFoto: "Azul", colores: ["Azul"],
    descripcion: "Crom Plus a gasolina: la versión más potente de la familia, con 10.19 HP y 17.10 Nm de torque.",
    destacados: ["10.19 HP y 17.10 Nm de torque", "Opera con gasolina", "Peso de 348 kg", "Diseño Crom Plus"],
    resumen: {"Motor": "4 tiempos", "Cilindrada": "198.88 cc", "Llantas": "4-8 sin cámara", "Potencia": "10.19 HP", "Torque": "17.10 Nm"},
    specs: {
      motor: [["Motor", "4 tiempos UG a gasolina"], ["Cilindrada", "198.88 cc"], ["Diámetro × carrera", "63.5 mm × 62.8 mm"], ["Bujía", "2 (Champion RG6HCC / Bosch UR6CC)"], ["Refrigeración", "Forzada por aire y aceite"], ["Embrague", "Multidisco húmedo (7 discos)"], ["Transmisión", "Engranaje constante, manual: 4 marchas + 1 reversa"], ["Potencia máxima", "10.19 HP a 5,000 ± 250 RPM"], ["Torque máximo", "17.10 Nm a 3,500 ± 250 RPM"]],
      chasis: [["Chasis", "Monocasco"], ["Neumáticos", "4-8, 4-6 PR (sin cámara)"], ["Frenos", "Tambor de expansión hidráulica, delantero y posterior"], ["Freno de estacionamiento", "Zapata de expansión mecánica"], ["Presión de llantas", "Delantera 36 PSI · posterior 40 PSI"]],
      consumo: [["Velocidad máxima", "65 km/h"], ["Capacidad de tanque", "8 L"], ["Capacidad de escalada", "19% (10.8°) máx."]],
      dimensiones: [["Largo", "2,635 mm"], ["Ancho", "1,300 mm"], ["Alto", "1,710 mm"], ["Radio de giro", "2,880 mm"], ["Peso", "348 kg"]],
      electrico: [["Sistema eléctrico", "12 V CC"], ["Batería", "32 Ah (arranque eléctrico) / 7 Ah (arranque no eléctrico)"], ["Bocina", "12 V DC, tipo 2A"]],
    },
  },
];

// Colores
export const COLORES = ["Rojo", "Azul", "Amarillo", "Verde", "Negro"];
export const COLOR_HEX = { Rojo: "#d3222c", Azul: "#1d6fd1", Amarillo: "#f2c200", Verde: "#1f9a3c", Negro: "#17191e" };
const CLAVE_COLOR = { Rojo: "rojo", Azul: "azul", Amarillo: "amarillo", Verde: "verde", Negro: "negro" };
export function filtroEntre(desde, hacia) {
  if (!hacia || desde === hacia) return "";
  const a = CLAVE_COLOR[desde]; const b = CLAVE_COLOR[hacia];
  if (!a || !b || a === "negro") return "";
  return `url(#epsa-color-${a}-${b})`;
}

// Ficha técnica y filtros del catálogo
export const TABS_TECNICOS = [
  { id: "motor", label: "Motor" },
  { id: "chasis", label: "Chasis y Carrocería" },
  { id: "consumo", label: "Consumo y Rendimiento" },
  { id: "dimensiones", label: "Dimensiones" },
  { id: "electrico", label: "Sistema eléctrico" },
];

export const FILTROS_CATALOGO = {
  tipoMotor: ["2 tiempos", "4 tiempos"],
  combustible: ["Gasolina", "GLP", "GNV"],
  uso: ["Pasajeros", "Carga"],
};

// Techos: un solo catálogo para la web, el panel, la separación, la venta y la preparación (tipos de techo de la base
// con su adicional referencial, regla del PO del 11 de noviembre). La web lo lee de GET /api/techos y el panel del
// formulario de separación; esta copia, con los mismos nombres y montos, solo se usa si la API no responde.
export const OPCIONES_TECHO = [
  { id: "lona", nombre: "Lona", precio: 200 },
  { id: "clasico", nombre: "Techo clásico de fibra", precio: 1700 },
  { id: "equipado", nombre: "Fibra clásica equipada", precio: 3200 },
  { id: "deportivo", nombre: "Techo de fibra deportiva", precio: 4000 },
];
export const SIN_TECHO = { id: "ninguno", nombre: "Sin techo", precio: 0 };
export const CUOTAS_INICIAL = [20, 30, 40, 50];
export const PLAZOS = [6, 12, 18, 24, 30, 36];

// Precio en soles
export const formatoSoles = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? "A consultar" : `S/ ${Number(n).toLocaleString("es-PE")}`);

// Ubicaciones y sedes
const HORARIO_SEDE = "Lunes a Sábado de 9:00 AM a 5:00 PM";
const HORARIO_NOTA = "Domingos: consultar por WhatsApp o en sede";
export const UBICACIONES = [
  { id: 1, nombre: "Comas", tipo: "Sede propia", direccion: "Av. 22 de Agosto 852, Comas, Lima", telefono: "907721481", correo: "inversionesepsamotor@gmail.com", horario: HORARIO_SEDE, horarioNota: HORARIO_NOTA, activo: true },
  { id: 2, nombre: "Ventanilla", tipo: "Sede propia", direccion: "Av. José Olaya Balandra Mz. Z, Lote 9, Ventanilla, Callao", telefono: "907721481", correo: "inversionesepsamotor@gmail.com", horario: HORARIO_SEDE, horarioNota: HORARIO_NOTA, activo: true },
  { id: 3, nombre: "Puente Piedra", tipo: "Sede propia", direccion: "Asoc. de Viv. Los Rosales, Mz. C, Lote 9, Puente Piedra, Lima", telefono: "907721481", correo: "inversionesepsamotor@gmail.com", horario: HORARIO_SEDE, horarioNota: HORARIO_NOTA, activo: true },
  { id: 4, nombre: "Crossland Ancón", tipo: "Almacén externo", direccion: "", telefono: "", correo: "", activo: true },
  { id: 5, nombre: "FIVESA", tipo: "Proveedor de techo", direccion: "", telefono: "", correo: "", activo: true },
  { id: 6, nombre: "JAVICAR", tipo: "Proveedor de techo", direccion: "", telefono: "", correo: "", activo: true },
  { id: 7, nombre: "FIBRAT", tipo: "Proveedor de techo", direccion: "", telefono: "", correo: "", activo: true },
];
export const TIPOS_UBICACION = ["Sede propia", "Almacén externo", "Proveedor de techo"];
export const TIPO_A_API = { "Sede propia": "Sede", "Almacén externo": "Almacen", "Proveedor de techo": "Proveedor" };
export const TIPO_DE_API = { Sede: "Sede propia", Almacen: "Almacén externo", Proveedor: "Proveedor de techo" };

// Mapas
export function enlaceGoogleMaps(direccion) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}
export function enlaceMapaEmbebido(direccion) {
  return `https://www.google.com/maps?q=${encodeURIComponent(direccion)}&output=embed`;
}

// Techo y preparación de unidades
export const TIPOS_TECHO = ["Sin techo", "Lona", "Techo clásico de fibra", "Fibra clásica equipada", "Techo de fibra deportiva"];
export const TECHO_REQUIERE_PROVEEDOR = (t) => t === "Techo de fibra deportiva";
export const PROVEEDORES_TECHO = ["FIVESA", "JAVICAR", "FIBRAT"];
export const MAX_DETALLE_TECHO = 250;
export function normalizarTecho(techo, proveedor) {
  const t = String(techo || "Sin techo");
  if (TIPOS_TECHO.includes(t)) return t;
  if (/equipad/i.test(t)) return "Fibra clásica equipada";
  if (/deportiv/i.test(t)) return "Techo de fibra deportiva";
  if (/fibra|cl[aá]sic|b[aá]sic/i.test(t)) return proveedor ? "Techo de fibra deportiva" : "Techo clásico de fibra";
  return /lona/i.test(t) ? "Lona" : "Sin techo";
}
export const ESTADOS_PREPARACION = ["Sin preparar", "Pendiente de techo", "En preparación", "Lista para entrega"];

// Leads
export const SEDES_ATENCION = ["Comas", "Ventanilla", "Puente Piedra"];
export const CANALES = ["WhatsApp", "Llamada", "Formulario web", "Visita a sede", "Facebook", "TikTok", "Referido"];
export const ESTADOS_LEAD = ["Nuevo", "En seguimiento", "Cotizado", "Cerrado ganado", "Perdido"];

// Equipo y cuentas
export const EQUIPO = [
  { id: 1, nombre: "Harold Salazar Masgo", usuario: "harold", correo: "75063427@mail.isil.pe", claveHash: "1f63a5e8af36546a4e12899ec1bb536618b8ba3228e2daaa0e29c01c1cf68893", claveTemporal: true, celular: "", rol: "gerente", cargo: "Gerente", sede: "Todas", activo: true, ausente: false, recibeLeads: false },
  { id: 2, nombre: "Jazmín Reinoso Rojas", usuario: "jazmin", correo: "60770861@mail.isil.pe", claveHash: "99a3ef76fbb883d337bd66128974ab5844d5cf866247738e79904e1ebad44878", claveTemporal: true, celular: "", rol: "administradora", cargo: "Administradora", sede: "Todas", activo: true, ausente: false, recibeLeads: false },
  { id: 3, nombre: "Adrián Dionicio Alcarraz", usuario: "adrian", correo: "60962083@mail.isil.pe", claveHash: "2ce34943d07888dea53d0274b09b11a9dd10206fa1cadffa89855f2bc78ed38c", claveTemporal: true, celular: "", rol: "administradora", cargo: "Administrador", sede: "Todas", activo: true, ausente: false, recibeLeads: false },
  { id: 4, nombre: "Didier Leguía Sandoval", usuario: "didier", correo: "61055074@mail.isil.pe", claveHash: "64b36b9cf9cb61b64a1fd039a45d3b1e29668547d9b609f2d14054acc145af21", claveTemporal: true, celular: "", rol: "vendedor", cargo: "Vendedor", sede: "Comas", activo: true, ausente: false, recibeLeads: true },
  { id: 5, nombre: "Michelle Fuentes Villaorduña", usuario: "michelle", correo: "61106576@mail.isil.pe", claveHash: "314d6b7d5b779aaa120d1509f684c59a3be3e721dbdd262a89f78359f10cae10", claveTemporal: true, celular: "", rol: "vendedor", cargo: "Vendedora", sede: "Ventanilla", activo: true, ausente: false, recibeLeads: true },
];


// Registros de ejemplo
const hoy = new Date();
const dia = (n) => new Date(hoy.getTime() - n * 86400000).toLocaleDateString("en-CA");

export const LEADS = [
  { id: 1, fecha: dia(0), contacto: "Carlos Ramírez", telefono: "987654321", canal: "Formulario web", modelo: "torito-4v-gsl", color: "Rojo", sede: "Comas", responsable: "Didier Leguía Sandoval", estado: "Nuevo", nota: "Techo: Techo clásico de fibra · Pago: Financiamiento" },
  { id: 2, fecha: dia(1), contacto: "María Torres", telefono: "955112233", canal: "WhatsApp", modelo: "torito-crom-plus-gnv", color: "Rojo", sede: "Ventanilla", responsable: "Michelle Fuentes Villaorduña", estado: "En seguimiento", nota: "Pidió crédito a 24 meses" },
  { id: 3, fecha: dia(3), contacto: "José Quispe", telefono: "944778899", canal: "Visita a sede", modelo: "torito-2t-ug-glp", color: "Verde", sede: "Comas", responsable: "Didier Leguía Sandoval", estado: "Cotizado", nota: "Cotización enviada" },
  { id: 4, fecha: dia(5), contacto: "Rosa Huamán", telefono: "933221100", canal: "Facebook", modelo: "torito-2t-ug-gsl", color: "Azul", sede: "Puente Piedra", responsable: "Sin asignar", estado: "Nuevo", nota: "" },
  { id: 5, fecha: dia(8), contacto: "Pedro Salas", telefono: "922334455", canal: "Referido", modelo: "torito-250-4v-glp", color: "Rojo", sede: "Comas", responsable: "Didier Leguía Sandoval", estado: "Cerrado ganado", nota: "Compró con techo Fibra clásica equipada" },
];

export const SEGUIMIENTOS = [
  { id: 1, leadId: 2, fecha: dia(-1), tipo: "Llamada", detalle: "Confirmar documentos para el crédito", responsable: "Michelle Fuentes Villaorduña", hecho: false },
  { id: 2, leadId: 3, fecha: dia(0), tipo: "WhatsApp", detalle: "Preguntar si decidió la compra", responsable: "Didier Leguía Sandoval", hecho: false },
  { id: 3, leadId: 1, fecha: dia(0), tipo: "Llamada", detalle: "Primer contacto: cotización web del Torito 4V GSL", responsable: "Didier Leguía Sandoval", hecho: false },
  { id: 4, leadId: 5, fecha: dia(6), tipo: "Visita", detalle: "Prueba de manejo en Comas", responsable: "Didier Leguía Sandoval", hecho: true },
];

export const VENTAS = [
  { id: 1, fecha: dia(0), cliente: "Carlos Ramírez", celular: "987654321", documento: "", modelo: "torito-4v-gsl", color: "Rojo", techo: "Techo clásico de fibra", techoPrecio: 1700, pago: "Financiamiento", etapa: "Solicitud web", vendedor: "Sin asignar", sede: "Comas", adelanto: 0, total: 19599, unidad: null, canal: "Formulario web", origen: "Web de EPSA", leadId: 1 },
  { id: 2, fecha: dia(2), cliente: "José Quispe", celular: "944778899", documento: "DNI 45879632", modelo: "torito-2t-ug-glp", color: "Verde", techo: "", techoPrecio: 0, pago: "Pago al contado", etapa: "Cotización", vendedor: "Didier Leguía Sandoval", sede: "Comas", adelanto: 0, total: 14699, unidad: null, canal: "Visita a sede", origen: "Pasó por la sede" },
  { id: 3, fecha: dia(6), cliente: "Mario Díaz", celular: "911137531", documento: "DNI 40007919", modelo: "torito-crom-plus-gnv", color: "Rojo", techo: "Lona", techoPrecio: 200, pago: "Financiamiento", etapa: "Pedido registrado", vendedor: "Michelle Fuentes Villaorduña", sede: "Ventanilla", adelanto: 5200, total: 17399, unidad: "MC-003", medioPago: "Transferencia", operacion: "OP-558201", canal: "WhatsApp", origen: "Referido" },
  { id: 4, fecha: dia(14), cliente: "Pedro Salas", celular: "922334455", documento: "DNI 41236587", modelo: "torito-250-4v-glp", color: "Rojo", techo: "Fibra clásica equipada", techoPrecio: 3200, pago: "Pago al contado", etapa: "Entregado", vendedor: "Didier Leguía Sandoval", sede: "Comas", adelanto: 21499, total: 21499, unidad: "MC-004", medioPago: "Efectivo", canal: "Referido", origen: "Referido",
    comprobante: { tipo: "Boleta de venta", serie: "B001", numero: 1, fecha: dia(14), cliente: "Pedro Salas", tipoDoc: "DNI", doc: "41236587", direccion: "", descripcion: "Motocar Torito 250 4V GLP color Rojo, motor BJM-10209, chasis BJC-88215 · techo Fibra clásica equipada", medio: "Efectivo", total: 21499, gravada: 21499 / 1.18, igv: 21499 - 21499 / 1.18, emitidoPor: "Harold Salazar Masgo", estado: "Emitido" } },
  { id: 5, fecha: dia(20), cliente: "Rosa Vega", celular: "911550124", documento: "DNI 40031676", modelo: "torito-2t-ug-gsl", color: "Azul", techo: "", techoPrecio: 0, pago: "Financiamiento", etapa: "Entregado", vendedor: "Michelle Fuentes Villaorduña", sede: "Ventanilla", adelanto: 4410, total: 12699, unidad: "MC-005", medioPago: "Yape / Plin", operacion: "YP-99812", canal: "Facebook", origen: "Redes sociales" },
];

export const METAS = [
  { id: 1, mes: hoy.toLocaleDateString("en-CA").slice(0, 7), sede: "Comas", meta: 6, registradas: 2 },
  { id: 2, mes: hoy.toLocaleDateString("en-CA").slice(0, 7), sede: "Ventanilla", meta: 5, registradas: 2 },
  { id: 3, mes: hoy.toLocaleDateString("en-CA").slice(0, 7), sede: "Puente Piedra", meta: 4, registradas: 0 },
];

const unidad = (n, modelo, color, ubicacion, disponibilidad, techo = "Sin techo", proveedorTecho = "", preparacion = "Lista para entrega") => ({
  id: `MC-${String(n).padStart(3, "0")}`, modelo, color, ubicacion, preparacion, techo, proveedorTecho,
  estadoTecho: techo === "Sin techo" ? "" : "Instalado", disponibilidad, motor: `BJM-${10200 + n * 3}`, chasis: `BJC-${88200 + n * 5}`,
  observaciones: [], historial: [{ fecha: dia(20), detalle: "Recepción desde Crosland" }],
});
// Inventario
export const UNIDADES = [
  unidad(1, "torito-4v-gsl", "Rojo", "Comas", "Disponible"),
  unidad(2, "torito-4v-glp", "Rojo", "Ventanilla", "Disponible", "Techo de fibra deportiva", "FIVESA"),
  unidad(3, "torito-crom-plus-gnv", "Rojo", "Ventanilla", "Separada", "Lona"),
  unidad(4, "torito-250-4v-glp", "Rojo", "Comas", "Vendida", "Techo de fibra deportiva", "JAVICAR"),
  unidad(5, "torito-2t-ug-gsl", "Azul", "Ventanilla", "Vendida"),
  unidad(6, "torito-2t-ug-glp", "Verde", "Puente Piedra", "Disponible"),
  unidad(7, "torito-4v-gnv", "Rojo", "JAVICAR", "No disponible", "Techo de fibra deportiva", "JAVICAR", "Pendiente de techo"),
  unidad(8, "torito-crom-plus-glp", "Azul", "Comas", "Separada"),
  unidad(9, "torito-250-4v-glp", "Rojo", "Puente Piedra", "Disponible"),
];

const IDENT_C2 = Array.from({ length: 3 }, (_, i) => ({ nummotuni: `CPG-${40100 + i * 7}`, chauni: `CPC-${77300 + i * 9}`, codmod: "6", coluni: "Rojo", fecreguni: dia(5) }));
UNIDADES.push(...IDENT_C2.map((u, i) => ({
  id: `MC-${String(10 + i).padStart(3, "0")}`, codcom: "2", modelo: "torito-crom-plus-gnv", color: "Rojo",
  ubicacion: i === 0 ? "Puente Piedra" : "", preparacion: "Sin preparar", techo: "Sin techo", proveedorTecho: "", estadoTecho: "", observaciones: [],
  disponibilidad: "No disponible", motor: u.nummotuni, chasis: u.chauni,
  historial: [{ fecha: dia(5), detalle: "Identificada en la compra #2" }, ...(i === 0 ? [{ fecha: dia(3), detalle: "Recepción desde Crosland en Puente Piedra" }] : [])],
})));

UNIDADES.push(
  unidad(13, "torito-2t-ug-gsl", "Azul", "Comas", "Disponible"),
  unidad(14, "torito-crom-plus-gnv", "Rojo", "Comas", "Disponible", "Techo clásico de fibra"),
  unidad(15, "torito-2t-ug-glp", "Rojo", "Ventanilla", "Separada"),
  unidad(16, "torito-4v-gsl", "Rojo", "Puente Piedra", "Disponible", "Lona"),
);

// Compras
export const COMPRAS = [
  { id: 1, codcom: "1", codmod: "1", nommod: "Torito 4V GSL", colcom: "Rojo", cancom: 4, cantidad_pendiente: 0, estcom: "Identificada", feccom: dia(30), horcom: "10:15", codusu: "Harold Salazar Masgo",
    factura: { codfac: "1", emisor: "Crosland Perú S.A.C.", numero: "F001-004512", fecha_emision: dia(28), cantidad_motos: 4, archivo_adjuntado: false }, unidades: [] },
  { id: 2, codcom: "2", codmod: "6", nommod: "Torito Crom Plus GNV", colcom: "Rojo", cancom: 5, cantidad_pendiente: 2, estcom: "Pendiente de identificación", feccom: dia(8), horcom: "11:40", codusu: "Jazmín Reinoso Rojas",
    factura: { codfac: "2", emisor: "Crosland Perú S.A.C.", numero: "F001-004598", fecha_emision: dia(6), cantidad_motos: 5, archivo_adjuntado: false }, unidades: IDENT_C2 },
  { id: 3, codcom: "3", codmod: "4", nommod: "Torito 2T UG GLP", colcom: "Amarillo", cancom: 3, cantidad_pendiente: 3, estcom: "Pendiente de factura", feccom: dia(1), horcom: "09:20", codusu: "Jazmín Reinoso Rojas", factura: null, unidades: [] },
];

// Sprint 2 · Reglas de movimientos, preparación y separaciones
export const ORIGEN_RECEPCION = "Crossland Ancón";
export const ESTADOS_MOVIMIENTO = ["En tránsito", "Finalizado", "Cancelado"];
export const MEDIOS_PAGO = ["Efectivo", "Transferencia", "Yape / Plin", "Depósito", "Tarjeta"];
export const MEDIOS_CON_OPERACION = ["Transferencia", "Yape / Plin", "Depósito", "Tarjeta"];
export const ADELANTO_MINIMO = 100;
export const DIAS_SEPARACION = 7;
export const MAX_EXTENSIONES = 2;
export const MOTIVOS_CANCELACION = ["El cliente desistió", "No aprobó el crédito", "Cambió de modelo o color", "Error al registrar", "Otro motivo"];
export const PASO_PREPARACION = {
  "Sin preparar": "Recién llegada a la sede. Falta revisarla.",
  "Pendiente de techo": "Espera que el proveedor instale el techo.",
  "En preparación": "Revisión, limpieza, placa provisional y accesorios.",
  "Lista para entrega": "Lista para vender. Ya aparece en Disponibilidad.",
};
export const CHECKLIST_RECEPCION = ["Llaves completas", "Manual y garantía", "Kit de herramientas", "Sin golpes ni rayones"];

// Fechas de ejemplo con hora
const instante = (n, h = 10, m = 0) => { const d = new Date(hoy.getTime() - n * 86400000); d.setHours(h, m, 0, 0); return d.toISOString(); };
const haceMinutos = (min) => new Date(hoy.getTime() - min * 60000).toISOString();
const unidadDe = (id) => UNIDADES.find((u) => u.id === id);
const anotar = (id, fecha, detalle) => { const u = unidadDe(id); if (u) u.historial.push({ fecha: new Date(fecha).toLocaleDateString("en-CA"), detalle }); };

// HU-003 · Movimientos de ubicación
let nMov = 0;
const mov = (unidad, tipo, origen, destino, n, h, extra = {}) => ({
  id: ++nMov, unidad, tipo, origen, destino, estado: "Finalizado", salida: instante(n, h), llegada: instante(n, h + 2),
  usuario: "Jazmín Reinoso Rojas", motivo: "", obs: "", ...extra,
});
export const MOVIMIENTOS = [
  ...UNIDADES.filter((u) => u.ubicacion && !u.codcom).map((u) => mov(u.id, "Recepción", ORIGEN_RECEPCION, u.id === "MC-002" ? "Comas" : u.id === "MC-007" ? "Puente Piedra" : u.ubicacion, 20, 9, { obs: "Llaves completas, manual y garantía, kit de herramientas." })),
  mov("MC-010", "Recepción", ORIGEN_RECEPCION, "Puente Piedra", 3, 9, { obs: "Llaves completas, manual y garantía. Falta el kit de herramientas." }),
  mov("MC-002", "Traslado", "Comas", "FIVESA", 15, 9, { motivo: "Instalación del techo de fibra deportiva" }),
  mov("MC-002", "Traslado", "FIVESA", "Ventanilla", 9, 14, { motivo: "Techo instalado", obs: "Techo revisado al llegar." }),
  mov("MC-007", "Traslado", "Puente Piedra", "JAVICAR", 2, 10, { motivo: "Instalación del techo de fibra deportiva" }),
  mov("MC-013", "Traslado", "Comas", "Ventanilla", 4, 11, { estado: "Cancelado", llegada: null, motivo: "Pedido de la sede Ventanilla", cancelacion: { fecha: instante(4, 12), motivo: "El cliente prefirió verla en Comas", usuario: "Harold Salazar Masgo" } }),
  { id: ++nMov, unidad: "MC-006", tipo: "Traslado", origen: "Puente Piedra", destino: "Comas", estado: "En tránsito", salida: haceMinutos(95), llegada: null, usuario: "Adrián Dionicio Alcarraz", motivo: "Un cliente de Comas quiere verla", obs: "" },
];
anotar("MC-002", instante(15, 9), "Traslado Comas → FIVESA (Instalación del techo de fibra deportiva)");
anotar("MC-002", instante(9, 16), "Traslado FIVESA → Ventanilla finalizado");
anotar("MC-013", instante(4, 12), "Traslado a Ventanilla cancelado: el cliente prefirió verla en Comas");
anotar("MC-006", haceMinutos(95), "Sale de Puente Piedra hacia Comas (en tránsito)");

// HU-033 · Historial de preparación
let nPrep = 0;
const paso = (unidad, pasoNuevo, anterior, fecha, usuario = "Jazmín Reinoso Rojas", obs = "") => ({ id: ++nPrep, unidad, paso: pasoNuevo, anterior, fecha, usuario, obs });
export const HISTORIAL_PREPARACION = [];
for (const u of UNIDADES) {
  if (!u.ubicacion) continue;
  if (u.id === "MC-010") { HISTORIAL_PREPARACION.push(paso(u.id, "Sin preparar", "", instante(3, 11))); continue; }
  HISTORIAL_PREPARACION.push(paso(u.id, "Sin preparar", "", instante(20, 11)));
  if (u.id === "MC-007") { HISTORIAL_PREPARACION.push(paso(u.id, "Pendiente de techo", "Sin preparar", instante(17, 10), "Jazmín Reinoso Rojas", "Techo de fibra deportiva encargado a JAVICAR")); continue; }
  const conTecho = u.techo && u.techo !== "Sin techo";
  if (conTecho) HISTORIAL_PREPARACION.push(paso(u.id, "Pendiente de techo", "Sin preparar", instante(u.id === "MC-002" ? 16 : 19, 9)));
  HISTORIAL_PREPARACION.push(paso(u.id, "En preparación", conTecho ? "Pendiente de techo" : "Sin preparar", instante(u.id === "MC-002" ? 9 : 18, 15)));
  HISTORIAL_PREPARACION.push(paso(u.id, "Lista para entrega", "En preparación", instante(u.id === "MC-002" ? 8 : 17, 12), "Jazmín Reinoso Rojas", "Revisión completa"));
}
unidadDe("MC-007").estadoTecho = "Pendiente de instalación";
anotar("MC-007", instante(17, 10), "Preparación: Pendiente de techo (fibra deportiva de JAVICAR)");
anotar("MC-007", instante(2, 12), "Traslado Puente Piedra → JAVICAR (Instalación del techo de fibra deportiva)");

// HU-005 · Clientes y separaciones
export const CLIENTES = [
  { id: 1, tipoDoc: "DNI", doc: "40007919", nombres: "Mario", apellidoPaterno: "Díaz", apellidoMaterno: "Ruiz", razonSocial: "", celular: "911137531", correo: "", registrado: dia(6) },
  { id: 2, tipoDoc: "DNI", doc: "45219876", nombres: "Luis Alberto", apellidoPaterno: "Huamán", apellidoMaterno: "Quispe", razonSocial: "", celular: "956112233", correo: "", registrado: dia(5) },
  { id: 3, tipoDoc: "CE", doc: "001234567", nombres: "Andrea", apellidoPaterno: "Morales", apellidoMaterno: "Pérez", razonSocial: "", celular: "934556677", correo: "", registrado: dia(8) },
  { id: 4, tipoDoc: "RUC", doc: "20609812347", nombres: "", apellidoPaterno: "", apellidoMaterno: "", razonSocial: "Mototaxis Unidos del Norte S.A.C.", celular: "987112244", correo: "", registrado: dia(4) },
];
export const SEPARACIONES = [
  { id: 1, unidad: "MC-003", cliente: 1, vendedor: "Michelle Fuentes Villaorduña", sede: "Ventanilla", monto: 5200, medio: "Transferencia", operacion: "OP558201", fechaPago: dia(6),
    voucher: { nombre: "transferencia-OP558201.pdf", tipo: "application/pdf", tamano: 182400, ejemplo: true }, fecha: instante(6, 11), vence: dia(-1), extensiones: 0, estado: "Convertida en venta",
    ventaId: 3, conversion: { fecha: instante(6, 12), usuario: "Michelle Fuentes Villaorduña" }, obs: "" },
  { id: 2, unidad: "MC-008", cliente: 2, vendedor: "Didier Leguía Sandoval", sede: "Comas", monto: 500, medio: "Yape / Plin", operacion: "YP77120", fechaPago: dia(5),
    voucher: { nombre: "yape-77120.jpg", tipo: "image/jpeg", tamano: 96300, ejemplo: true }, fecha: instante(5, 16), vence: dia(-2), extensiones: 0, estado: "Activa", obs: "Viene el sábado con su DNI para el crédito." },
  { id: 3, unidad: "MC-015", cliente: 3, vendedor: "Michelle Fuentes Villaorduña", sede: "Ventanilla", monto: 300, medio: "Efectivo", operacion: "", fechaPago: dia(8),
    voucher: null, fecha: instante(8, 10), vence: dia(1), extensiones: 0, estado: "Activa", obs: "Recibo de caja N° 0451." },
  { id: 4, unidad: "MC-009", cliente: 4, vendedor: "Didier Leguía Sandoval", sede: "Puente Piedra", monto: 1000, medio: "Transferencia", operacion: "OP660019", fechaPago: dia(4),
    voucher: { nombre: "transferencia-OP660019.png", tipo: "image/png", tamano: 140220, ejemplo: true }, fecha: instante(4, 12), vence: dia(-3), extensiones: 0, estado: "Cancelada",
    cancelacion: { fecha: instante(2, 15), motivo: "No aprobó el crédito", detalle: "La financiera no aprobó la evaluación.", usuario: "Harold Salazar Masgo" }, obs: "" },
];
anotar("MC-008", instante(5, 16), "Separada para Luis Alberto Huamán Quispe (adelanto S/ 500, Yape / Plin)");
anotar("MC-015", instante(8, 10), "Separada para Andrea Morales Pérez (adelanto S/ 300, efectivo)");
anotar("MC-009", instante(4, 12), "Separada para Mototaxis Unidos del Norte S.A.C. (adelanto S/ 1,000)");
anotar("MC-009", instante(2, 15), "Separación cancelada: No aprobó el crédito. Vuelve a estar disponible");
for (const u of UNIDADES) u.historial.sort((a, b) => a.fecha.localeCompare(b.fecha));

// HU-036 · Fotos de cada modelo (las oficiales de torito.pe)
let nImg = 0;
export const IMAGENES_MODELO = [];
for (const m of MODELOS) {
  const vistas = new Set();
  const agregarFoto = (url, color, principal) => {
    if (!url || vistas.has(url)) return;
    vistas.add(url);
    IMAGENES_MODELO.push({ id: ++nImg, modelo: m.id, url, archivo: "", orden: vistas.size, principal, color: color || "", activa: true, origen: "Oficial", fecha: dia(30), usuario: "Sistema" });
  };
  agregarFoto(m.imagen, m.colorFoto || (m.colores?.length === 1 ? m.colores[0] : "Rojo"), true);
  for (const [c, url] of Object.entries(m.fotosColor || {})) agregarFoto(url, c, false);
}

// Opiniones
export const OPINIONES = [
  { id: 1, nombre: "Cliente de Comas", sede: "Comas", modelo: "torito-crom-plus-glp", etiqueta: "Pasajeros", estrellas: 5, texto: "Trabajo turnos largos y necesitaba un motor parejo. Me explicaron bien el financiamiento y salí con mi unidad el mismo mes.", publicado: true, ejemplo: true },
  { id: 2, nombre: "Cliente de Ventanilla", sede: "Ventanilla", modelo: "torito-2t-ug-gsl", etiqueta: "Inicio de negocio", estrellas: 5, texto: "Buscaba algo accesible para empezar. Me mostraron opciones al contado y a crédito sin presión, y por WhatsApp respondieron rápido.", publicado: true, ejemplo: true },
  { id: 3, nombre: "Cliente de Puente Piedra", sede: "Puente Piedra", modelo: "torito-250-4v-glp", etiqueta: "Carga", estrellas: 5, texto: "Necesitaba una unidad con buen torque para reparto. Me cotizaron claro, con el techo incluido, y vi la moto en la sede.", publicado: true, ejemplo: true },
  { id: 4, nombre: "Cliente de Comas", sede: "Comas", modelo: "torito-crom-plus-gsl", etiqueta: "Financiamiento", estrellas: 5, texto: "Evaluaron mi crédito con mi DNI y un recibo de servicios. En pocos días ya estaba trabajando con mi unidad.", publicado: true, ejemplo: true },
  { id: 5, nombre: "Cliente de Ventanilla", sede: "Ventanilla", modelo: "torito-4v-glp", etiqueta: "Ahorro", estrellas: 5, texto: "Con GLP gasto bastante menos que con gasolina. Ese ahorro me ayuda a pagar la cuota tranquilo.", publicado: true, ejemplo: true },
  { id: 6, nombre: "Cliente de Puente Piedra", sede: "Puente Piedra", modelo: "torito-4v-gnv", etiqueta: "Logística", estrellas: 5, texto: "Compré para mi negocio de mercadería. Me acompañaron con la placa y la tarjeta de propiedad sin costo.", publicado: true, ejemplo: true },
  { id: 7, nombre: "Cliente de Comas", sede: "Comas", modelo: "torito-2t-ug-glp", etiqueta: "Pasajeros", estrellas: 4, texto: "Elegí el color que quería y el techo de fibra. Me explicaron el total con todo incluido desde el inicio.", publicado: true, ejemplo: true },
  { id: 8, nombre: "Cliente de Ventanilla", sede: "Ventanilla", modelo: "torito-4v-gsl", etiqueta: "Inicio de negocio", estrellas: 5, texto: "Primera vez que compraba un mototaxi. Me asesoraron paso a paso y me llamaron el mismo día que coticé.", publicado: true, ejemplo: true },
];

// HU-007 · Roles y permisos
export const ROLES = {
  gerente: {
    nombre: "Gerente",
    puede: ["resumen", "leads", "seguimiento", "disponibilidad", "separaciones", "ventas", "facturas", "metas", "modelos", "opiniones", "inventario", "movimientos", "preparacion", "ubicaciones", "compras", "facturasRecibidas", "equipo", "permisos"],
    permisos: ["*"],
    descripcion: "Acceso total: crea, edita, desactiva y elimina. Administra sedes, usuarios y metas, y emite comprobantes.",
  },
  administradora: {
    nombre: "Administradora",
    puede: ["resumen", "leads", "seguimiento", "disponibilidad", "separaciones", "ventas", "facturas", "metas", "modelos", "opiniones", "inventario", "movimientos", "preparacion", "ubicaciones", "compras", "facturasRecibidas", "equipo"],
    permisos: ["ver", "crear", "editar", "mover", "modelos.editar", "modelos.publicar", "compras.registrar", "compras.factura", "unidades.gestionar", "unidades.trasladar", "leads.ausencia", "leads.asignar", "comprobantes.emitir", "ubicaciones.gestionar", "separaciones.registrar", "separaciones.gestionar"],
    descripcion: "Gestiona modelos, compras, facturas de proveedor, inventario, movimientos, preparación, separaciones y comprobantes de venta. No elimina ni administra usuarios.",
  },
  vendedor: {
    nombre: "Vendedor",
    puede: ["resumen", "leads", "seguimiento", "disponibilidad", "separaciones", "ventas", "inventario"],
    permisos: ["ver", "crear", "unidades.observar", "separaciones.registrar"],
    descripcion: "Atiende leads y seguimiento, consulta la disponibilidad, separa motos con adelanto y registra ventas. No ve compras, ubicaciones ni facturación.",
  },
};
