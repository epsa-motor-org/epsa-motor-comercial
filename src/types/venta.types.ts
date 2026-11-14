export type ModalidadVenta = 'Contado' | 'Crédito';
export type DecisionTechoVenta = 'Por definir' | 'Sin techo' | 'Con techo';

export type TechoVentaRequest =
  | { decision: 'Por definir' | 'Sin techo' }
  | { decision: 'Con techo'; codtte: number };

export interface PagoEfectivoVentaRequest {
  monto: number;
  fecha: string;
  medioPago: 'Efectivo';
  observacion: string;
  ingresoConfirmado: true;
}

export interface PagoTransferenciaVentaRequest {
  monto: number;
  fecha: string;
  medioPago: 'Transferencia';
  referencia: string;
  rutaEvidencia: string;
  observacion?: string | null;
  ingresoConfirmado: true;
  codusuConfirmador: number;
}

export type PagoVentaRequest = PagoEfectivoVentaRequest | PagoTransferenciaVentaRequest;

export interface ComprobanteExternoVentaRequest {
  referencia: string;
  fecha: string;
}

export interface CrearVentaRequest {
  codcli: number;
  codusuResponsable: number;
  codsedAtencion: number;
  fechaVenta: string;
  modalidad: ModalidadVenta;
  /** El precio base se obtiene en PostgreSQL desde modelo.premod. */
  adicionalTechoAcordado?: number;
  descuento?: number;
  motivoDescuento?: string;
  codusuAutorizadorDescuento?: number;
  confirmacionTelefonicaRecibida?: boolean;
  codsedEntregaPrevista?: number | null;
  pagos?: PagoVentaRequest[];
  techo?: TechoVentaRequest | null;
  comprobanteExterno?: ComprobanteExternoVentaRequest | null;
  observacion?: string | null;
}

export interface PagoVentaInput {
  monto: number;
  fecha: string;
  medioPago: 'Efectivo' | 'Transferencia';
  referencia: string | null;
  rutaEvidencia: string | null;
  observacion: string | null;
  ingresoConfirmado: boolean;
  codusuConfirmador: number | null;
}

export interface CrearVentaInput {
  p_coduni: string;
  p_codcli: string;
  p_codusuresp: string;
  p_codsedatencion: string;
  p_fecven: string;
  p_modcomven: ModalidadVenta;
  p_adicionalacordado: number | null;
  p_descuento: number;
  p_motivodescuento: string | null;
  p_codusuautorizadesc: string | null;
  p_conftelefonicadesc: boolean;
  p_codsedentregaprevista: string | null;
  p_pagos: PagoVentaInput[];
  p_techo: TechoVentaRequest | null;
  p_refcompven: string | null;
  p_feccompven: string | null;
  p_obsven: string | null;
  p_idempotenciaven: string;
}

export interface PersonaVenta {
  codusu: string;
  nombre: string;
}

export interface SedeVenta {
  codsed: string;
  nombre: string;
}

export interface TechoVentaResultado {
  decision: DecisionTechoVenta;
  codtte: string | null;
  fecha: string | null;
  decididoPor: string | null;
}

export interface PagoVentaResultado {
  codpagven: string;
  numero: number;
  monto: number;
  fecha: string;
  medioPago: 'Efectivo' | 'Transferencia';
  referencia: string | null;
  rutaEvidencia: string | null;
  observacion: string | null;
  ingresoConfirmado: boolean;
  confirmadoPor: string;
  fechaConfirmacion: string;
  autor: string;
}

export interface CrearVentaResultado {
  codven: string;
  coduni: string;
  codcli: string;
  codsep: string | null;
  autor: PersonaVenta;
  responsable: PersonaVenta;
  sedeAtencion: SedeVenta;
  sedeEntregaPrevista: SedeVenta | null;
  fechaVenta: string;
  modalidad: ModalidadVenta;
  precioBaseAcordado: number | null;
  adicionalTechoReferencial: number | null;
  adicionalTechoAcordado: number | null;
  importeAntesDescuento: number | null;
  descuento: number | null;
  motivoDescuento: string | null;
  codusuAutorizadorDescuento: string | null;
  nombreAutorizadorDescuento: string | null;
  confirmacionTelefonicaRecibida: boolean | null;
  fechaConfirmacionTelefonica: string | null;
  importe: number;
  totalRecibido: number;
  saldo: number;
  pagos: PagoVentaResultado[];
  techo: TechoVentaResultado;
  comprobanteExterno: ComprobanteExternoVentaRequest | null;
  observacion: string | null;
  estado: string;
  reutilizada: boolean;
}

export interface GuardarTechoVentaInput {
  p_codven: string;
  p_decisiontecho: DecisionTechoVenta;
  p_codtte: string | null;
  p_adicionalacordado: number | null;
}

export interface GuardarTechoVentaResultado {
  codven: string;
  decision: DecisionTechoVenta;
  codtte: string | null;
  precioBaseAcordado: number | null;
  adicionalTechoReferencial: number | null;
  adicionalTechoAcordado: number | null;
  importeAntesDescuento: number | null;
  descuento: number | null;
  motivoDescuento: string | null;
  codusuAutorizadorDescuento: string | null;
  nombreAutorizadorDescuento: string | null;
  confirmacionTelefonicaRecibida: boolean | null;
  fechaConfirmacionTelefonica: string | null;
  importe: number | null;
  totalRecibido: number | null;
  saldo: number | null;
  guardado: true;
  reutilizada: boolean;
}

export interface GuardarComprobanteVentaInput {
  p_codven: string;
  p_referencia: string;
  p_fecha: string;
}

export interface GuardarComprobanteVentaResultado {
  codven: string;
  comprobanteExterno: ComprobanteExternoVentaRequest;
  guardado: true;
  reutilizada: boolean;
}

export type FormatoEvidenciaVenta = 'jpeg' | 'png' | 'webp' | 'pdf';

export interface EvidenciaVentaSubida {
  rutaEvidencia: string;
  tipo: string;
  tamano: number;
}

export interface ErrorVentaBD {
  code?: string;
}

export interface ConsultaVentasInput {
  p_busqueda: string | null;
  p_limite: number;
  p_offset: number;
}

export interface VentaListado {
  codven: string;
  fecha: string;
  comprador: { codcli: string; nombre: string; celular: string | null };
  unidad: { coduni: string; motor: string | null; chasis: string | null; color: string | null };
  modelo: { codmod: string; nombre: string };
  responsable: PersonaVenta;
  modalidad: ModalidadVenta;
  precioBaseAcordado: number | null;
  adicionalTechoReferencial: number | null;
  adicionalTechoAcordado: number | null;
  importeAntesDescuento: number | null;
  descuento: number | null;
  motivoDescuento: string | null;
  codusuAutorizadorDescuento: string | null;
  nombreAutorizadorDescuento: string | null;
  confirmacionTelefonicaRecibida: boolean | null;
  fechaConfirmacionTelefonica: string | null;
  total: number | null;
  adelanto: number;
  pagos: Array<{ numero: number; monto: number; fecha: string; medioPago: string; referencia: string | null }>;
  totalRecibido: number;
  saldo: number | null;
  techo: { decision: DecisionTechoVenta | null; codtte: string | null; nombre: string | null };
  sedeAtencion: SedeVenta;
  sedeEntregaPrevista: SedeVenta | null;
  estado: string;
  comprobanteExterno: ComprobanteExternoVentaRequest | null;
}

export interface ConsultaVentasResultado {
  items: VentaListado[];
  total: number;
  limite: number;
  offset: number;
}
