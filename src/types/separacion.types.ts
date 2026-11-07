export interface CrearSeparacionRequest {
  codcli: number;
  codusuResponsable: number;
  codusuConfirmador?: number;
  monto: number;
  fechaPago: string;
  medioPago: string;
  referencia?: string | null;
  rutaEvidencia?: string | null;
  observacion?: string | null;
  ingresoConfirmado: boolean;
}

export interface CrearSeparacionInput {
  p_coduni: string;
  p_codcli: string;
  p_codusuresp: string;
  p_codusu_confirmador: string | null;
  p_monadesep: number;
  p_fecpagsep: string;
  p_metpagsep: string;
  p_refsep: string | null;
  p_rutavouchersep: string | null;
  p_obssep: string | null;
  p_ingreso_confirmado: boolean;
  p_idempotenciasep: string;
}

export interface CrearSeparacionResultado {
  codsep: string;
  coduni: string;
  codcli: string;
  codusuAutor: string;
  codusuResponsable: string;
  monto: number;
  fechaPago: string;
  medioPago: string;
  referencia: string | null;
  rutaEvidencia: string | null;
  observacion: string | null;
  ingresoConfirmado: boolean;
  confirmadoPor: string;
  fechaConfirmacion: string;
  fechaRegistro: string;
  estado: string;
  reutilizada: boolean;
}

export interface ErrorSeparacionBD {
  code?: string;
}
