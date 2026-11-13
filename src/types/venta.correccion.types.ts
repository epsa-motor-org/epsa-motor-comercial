export interface CorreccionRelacionRequest {
  motivo: string;
  versionEsperada: number;
  codcliNuevo?: number;
  coduniNuevo?: number;
}

export interface OperacionIntercambioRequest {
  codven: number;
  versionEsperada: number;
  codcliNuevo?: number;
  coduniNuevo: number;
}

export interface IntercambioRelacionRequest {
  motivo: string;
  operaciones: [OperacionIntercambioRequest, OperacionIntercambioRequest];
}

export interface CorreccionRelacionIndividualInput {
  p_codven: string;
  p_codcli_nuevo: string | null;
  p_coduni_nuevo: string | null;
  p_version_esperada: number;
  p_motivo: string;
  p_idempotencia: string;
}

export interface IntercambioRelacionInput {
  p_codven_a: string;
  p_codcli_a_nuevo: string | null;
  p_coduni_a_nueva: string;
  p_version_a: number;
  p_codven_b: string;
  p_codcli_b_nuevo: string | null;
  p_coduni_b_nueva: string;
  p_version_b: number;
  p_motivo: string;
  p_idempotencia: string;
}

export interface UnidadPreviewCorreccion {
  coduni: string;
  motor: string;
  chasis: string;
  modelo: string;
  color: string | null;
  estadoComercial: string;
  techoFisico: { codtte: string | null; estado: string | null };
}

export interface VentaPreviewCorreccion {
  codven: string;
  versionRelacion: number;
  estado: string;
  comprador: { codcli: string; nombre: string };
  unidad: UnidadPreviewCorreccion;
  finanzas: {
    precioBaseAcordado: number | null;
    adicionalTechoReferencial: number | null;
    adicionalTechoAcordado: number | null;
    total: number | null;
    pagos: number;
    totalPagos: number;
    tienePagos: boolean;
    adelantoSeparacion: number;
    tieneAdelanto: boolean;
    totalRecibido: number;
    saldo: number | null;
    comprobanteExterno: { referencia: string; fecha: string } | null;
  };
  techo: { decision: string | null; codtte: string | null };
  separacionVinculada: {
    codsep: string;
    estado: string;
    codcliHistorico: string;
    coduniHistorica: string;
    adelantoConfirmado: boolean;
    montoAdelanto: number;
  } | null;
  entrega: 'HU-032 pendiente de fuente autoritativa';
}

export interface PreviewCorreccionRelacionResultado {
  venta: VentaPreviewCorreccion;
  advertencias: string[];
}

export interface PreviewIntercambioRelacionResultado {
  operaciones: [VentaPreviewCorreccion, VentaPreviewCorreccion];
  advertencias: string[];
}

export interface CorreccionRelacionOperacionResultado {
  codven: string;
  codcliAnterior: string;
  codcliNuevo: string;
  coduniAnterior: string;
  coduniNueva: string;
  versionAnterior: number;
  versionRelacion: number;
  estadoUnidadAnterior: string;
  estadoUnidadOrigenResultante: string;
  estadoUnidadDestinoAnterior: string;
  estadoUnidadResultante: string;
  codsepVinculada: string | null;
  venta: VentaPreviewCorreccion;
}

export interface CorreccionRelacionResultado {
  codcor: string;
  tipo: 'Individual' | 'Intercambio';
  motivo: string;
  actor: string;
  reutilizada: boolean;
  operaciones: CorreccionRelacionOperacionResultado[];
}

export interface HistorialCorreccionRelacionItem {
  codcor: string;
  tipo: 'Individual' | 'Intercambio';
  fecha: string;
  motivo: string;
  actor: { codusu: string; nombre: string };
  operaciones: Array<Omit<CorreccionRelacionOperacionResultado, 'venta'>>;
}

export interface ErrorVentaCorreccionBD {
  code?: string;
}

export interface ConsultaIntercambioInput {
  p_codven_a: string;
  p_codven_b: string;
}
