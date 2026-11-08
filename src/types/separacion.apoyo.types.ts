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
}

export interface TipoTechoSeparacion {
  codtte: string;
  nombre: string;
  requiereInstalacion: boolean;
}

export interface TechoElegido {
  coduni: string;
  techo: TipoTechoSeparacion;
  preparacion: unknown;
}

export interface CompradorSeparacion {
  codcli: string;
  codtdo: string;
  tipoDocumento: string;
  numeroDocumento: string;
  nombres: string;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
  existente?: boolean;
}

export interface RegistrarCompradorInput {
  p_codtdo: string;
  p_numdoc: string;
  p_nombres: string;
  p_apellido_paterno: string | null;
  p_apellido_materno: string | null;
  p_telefono: string;
  p_correo: string;
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
  techo: {
    codtte: string | null;
    nombre: string | null;
    requiereInstalacion: boolean;
    estado: string | null;
    proveedor: string | null;
  } | null;
}
