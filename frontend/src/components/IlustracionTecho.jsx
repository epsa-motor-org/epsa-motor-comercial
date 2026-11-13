// Ilustración propia de un Torito de perfil con cada tipo de techo (Sedes, «Elige tu techo»).
// Es referencial: los acabados reales se ven en la sede. Colores de la marca: marino y el rojo Torito.
const MARINO = "#0e2c52";
const ROJO = "#c62828";
const ROJO_OSCURO = "#9f1d1d";
const LLANTA = "#1f2937";
const ARO = "#cbd5e1";
const CROMO = "#e2e8f0";
const VIDRIO = "#bfdbfe";
const LONA = "#e8dcc0";
const LONA_BORDE = "#a8916a";

// ---------------------------------------------------------------------------------------------
// La moto sin techo: llantas, carrocería, frente y asientos (es la base de todas las versiones)
// ---------------------------------------------------------------------------------------------
function Base() {
  return (
    <g>
      <ellipse cx="132" cy="147" rx="104" ry="5" fill={MARINO} opacity=".12" />
      {/* Carrocería trasera */}
      <path d="M40 92 L40 120 Q40 126 46 126 L57 126 A21 21 0 0 1 99 126 L168 126 Q176 126 178 118 L182 104 L168 92 Z" fill={ROJO} stroke={ROJO_OSCURO} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Frente: escudo, faro y manubrio */}
      <path d="M176 120 L184 100 L192 68 Q194 64 199 64 L203 65 L205 86 Q216 92 219 110 L219 114 L208 114 Q204 108 196 112 L190 120 Z" fill={ROJO} stroke={ROJO_OSCURO} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M199 128 Q201 116 212 116 Q223 116 225 128" fill="none" stroke={LLANTA} strokeWidth="3" strokeLinecap="round" />
      <circle cx="209" cy="94" r="3.2" fill="#fde68a" stroke="#92400e" strokeWidth="1" />
      <path d="M198 64 L196 57 M186 60 L205 55" stroke={LLANTA} strokeWidth="3" strokeLinecap="round" />
      {/* Asientos */}
      <path d="M46 60 Q46 56 51 56 H56 Q60 56 60 60 L58 92 H46 Z" fill={LLANTA} />
      <path d="M48 84 H112 Q118 84 118 89 V92 H48 Z" fill={LLANTA} />
      <path d="M130 84 H162 Q168 84 168 89 V92 H130 Z" fill={LLANTA} />
      {/* Llantas */}
      <circle cx="78" cy="128" r="17" fill={LLANTA} />
      <circle cx="78" cy="128" r="8" fill={ARO} />
      <circle cx="78" cy="128" r="3" fill="#64748b" />
      <circle cx="212" cy="131" r="13" fill={LLANTA} />
      <circle cx="212" cy="131" r="6" fill={ARO} />
      <circle cx="212" cy="131" r="2.4" fill="#64748b" />
    </g>
  );
}

// Parantes de fibra (techos de fibra clásico, clásico equipado y deportivo)
const Parantes = () => (
  <g fill={MARINO}>
    <rect x="38" y="44" width="6" height="48" rx="2" />
    <rect x="121" y="44" width="5" height="46" rx="2" />
    <path d="M192 46 L197 46 L202 64 L197 65 Z" />
  </g>
);

// Flecos de la lona
const flecos = () => {
  let d = "M36 44";
  for (let x = 36; x < 200; x += 8) d += " q4 5 8 0";
  return `${d} Z`;
};

// ---------------------------------------------------------------------------------------------
// Cada techo
// ---------------------------------------------------------------------------------------------
const TECHOS = {
  ninguno: () => null,
  lona: () => (
    <g>
      <path d="M42 92 V42 M124 90 V42 M194 44 L199 64" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
      <path d="M36 44 Q36 32 50 31 H182 Q196 32 200 44 Z" fill={LONA} stroke={LONA_BORDE} strokeWidth="1.5" strokeLinejoin="round" />
      <path d={flecos()} fill={LONA} stroke={LONA_BORDE} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M48 37 H186" stroke={LONA_BORDE} strokeWidth="1" strokeDasharray="3 3" />
    </g>
  ),
  basico: () => (
    <g>
      <Parantes />
      <path d="M34 46 Q34 30 52 28 H180 Q198 30 202 46 Z" fill={MARINO} />
      <path d="M56 32 H176" stroke="#fff" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  superlujo: () => (
    <g>
      <Parantes />
      <path d="M36 48 H46 V92 H38 Z" fill={MARINO} />
      <path d="M170 48 H194 L200 63 L190 66 Z" fill={VIDRIO} opacity=".85" stroke={MARINO} strokeWidth="1.2" />
      <path d="M34 46 Q34 30 52 28 H180 Q198 30 202 46 Z" fill={MARINO} />
      <rect x="34" y="44" width="168" height="4" rx="2" fill={CROMO} />
      <path d="M56 32 H176" stroke="#fff" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
      <path d="M46 106 H168" stroke={CROMO} strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  deportivo: () => (
    <g>
      <Parantes />
      <path d="M36 52 H46 V92 H38 Z" fill={MARINO} />
      <path d="M168 50 H196 L202 63 L190 67 Z" fill="#475569" opacity=".8" stroke={MARINO} strokeWidth="1.2" />
      <path d="M36 50 Q38 30 60 27 H168 Q190 29 204 50 Z" fill={MARINO} />
      <path d="M36 35 L22 31 Q19 37 25 39 L38 42 Z" fill={ROJO} />
      <path d="M66 31 H160" stroke={ROJO} strokeWidth="3" strokeLinecap="round" />
      <path d="M72 36 H154" stroke={ROJO} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="36" y="48" width="168" height="3.5" rx="1.75" fill={CROMO} />
      <path d="M118 124 L138 95 M130 124 L150 95" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".9" />
    </g>
  ),
};

// Los techos del catálogo (servicios/techos.js) usan el dibujo más parecido
const DIBUJO = { clasico: "basico", equipado: "superlujo" };
export default function IlustracionTecho({ tipo = "ninguno", nombre = "", className = "" }) {
  const Techo = TECHOS[DIBUJO[tipo] || tipo] || TECHOS.ninguno;
  return (
    <svg viewBox="0 0 240 155" className={className} role="img" aria-label={`Torito ${tipo === "ninguno" ? "sin techo" : `con techo ${nombre}`} (ilustración referencial)`} xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(-6 0)">
        <Base />
        <Techo />
      </g>
    </svg>
  );
}
