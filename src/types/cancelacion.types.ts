export interface CancelarOperacionRequest {
  motivo: string;
  observacionDinero?: string | null;
}

export interface CancelarSeparacionInput {
  p_codsep: string;
  p_motivo: string;
  p_observacion_dinero: string | null;
  p_idempotencia: string;
}

export interface CancelarVentaInput {
  p_codven: string;
  p_motivo: string;
  p_observacion_dinero: string | null;
  p_idempotencia: string;
}

export interface FinanzasCancelacionResultado {
  adelanto?: number;
  medioPago?: string;
  totalRecibido?: number;
  evidenciaConservada?: boolean;
  importe?: number | null;
  adelantoSeparacion?: number;
  pagosVenta?: number;
  cantidadPagos?: number;
  saldo?: number | null;
  comprobanteExternoConservado?: boolean;
  estadoSeparacionVinculada?: string | null;
}

export interface CancelacionResultado {
  tipoOperacion: 'Separacion' | 'Venta';
  codsep?: string;
  codven?: string;
  estado: 'Cancelada';
  cancelador: string;
  fechaCancelacion: string;
  motivo: string;
  observacionDinero: string | null;
  estadoComercialUnidad: 'Disponible' | 'Separada' | 'Vendida';
  unidadLiberada: boolean;
  finanzasConservadas: FinanzasCancelacionResultado;
  reutilizada: boolean;
}

export interface CancelacionConsulta {
  tipoOperacion: 'Separacion' | 'Venta';
  codOperacion: string;
  accion: 'Cancelacion';
  actor: { codusu: string; nombre: string };
  fecha: string;
  motivo: string;
  observacionFinanciera: string | null;
  estadoAnterior: string;
  estadoResultante: 'Cancelada';
  estadoComercialResultante: 'Disponible' | 'Separada' | 'Vendida';
}

export interface ErrorCancelacionBD {
  code?: string;
}
