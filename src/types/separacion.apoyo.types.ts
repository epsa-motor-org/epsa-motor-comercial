// HU-005 · Datos de apoyo para separar desde el panel: formulario, comprador y captura de transferencia.

export interface ParticipanteSeparacion {
  codusu: string;
  nombre: string;
  rol?: string;
}

export interface FormularioSeparacion {
  usuarioActual: { codusu: string; rol: string };
  tiposDocumento: { codtdo: string; nombre: string }[];
  responsables: ParticipanteSeparacion[];
  gerentes: ParticipanteSeparacion[];
  tiposTecho: TipoTechoSeparacion[];
  preciosLista: Record<string, number>;
}

export interface TipoTechoSeparacion {
  codtte: string;
  nombre: string;
  requiereInstalacion: boolean;
  /** true solo para «Sin techo»: el tipo que no lleva instalación ni proveedor */
  sinTecho?: boolean;
}

export type DecisionTecho = 'Por definir' | 'Sin techo' | 'Con techo';

export interface TechoElegido {
  coduni: string;
  codsep: string;
  decision: DecisionTecho;
  techo: TipoTechoSeparacion;
  preparacion: unknown;
}

// Desde el 8 de noviembre el comprador se registra sin documento: tipo y número llegan en null
export interface CompradorSeparacion {
  codcli: string;
  codtdo: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  nombres: string;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
  existente?: boolean;
}

export interface RegistrarCompradorInput {
  p_nombres: string;
  p_apellido_paterno: string;
  p_apellido_materno: string | null;
  p_telefono: string;
}

export type FormatoEvidencia = 'jpeg' | 'png' | 'webp' | 'pdf';

export interface EvidenciaSubida {
  rutaEvidencia: string;
  tipo: string;
  tamano: number;
}

export interface PersonaSeparacion { codusu: string; nombre: string }

export interface SeparacionActiva {
  codsep: string;
  coduni: string;
  comprador: CompradorSeparacion | null;
  autor: PersonaSeparacion | null;
  responsable: PersonaSeparacion | null;
  confirmador: PersonaSeparacion | null;
  monto: number;
  fechaPago: string | null;
  medioPago: string;
  referencia: string | null;
  rutaEvidencia: string | null;
  observacion: string | null;
  ingresoConfirmado: boolean | null;
  fechaConfirmacion: string | null;
  fechaRegistro: string;
  estado: string;
  decisionTecho: {
    decision: DecisionTecho;
    codtte: string | null;
    nombre: string | null;
    requiereInstalacion: boolean;
    fecha: string | null;
    por: string | null;
  };
  techo: {
    codtte: string | null;
    nombre: string | null;
    requiereInstalacion: boolean;
    estado: string | null;
    proveedor: string | null;
  } | null;
}
