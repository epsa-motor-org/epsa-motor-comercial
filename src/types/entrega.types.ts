export type ModalidadEntrega = 'Armada' | 'Embalada';

export interface RegistrarEntregaRequest {
  coduni: number;
  codcli: number;
  modalidad: ModalidadEntrega;
  fecha: string;
  receptor: string;
  observacion?: string | null;
  documentosPendientes: boolean;
  observacionDocumentos?: string | null;
  referenciaGuia?: string | null;
}

export interface RegistrarEntregaInput {
  p_codven: string;
  p_coduni: string;
  p_codcli: string;
  p_modalidad: ModalidadEntrega;
  p_fecha: string;
  p_receptor: string;
  p_observacion: string | null;
  p_documentos_pendientes: boolean;
  p_observacion_documentos: string | null;
  p_referencia_guia: string | null;
  p_idempotencia: string;
}

export interface SedeEntrega {
  codsed: string;
  nombre: string;
}

export interface EntregaRegistrada {
  codentrega: string;
  codven: string;
  coduni: string;
  codcli: string;
  modalidad: ModalidadEntrega;
  sedeAcordada: SedeEntrega;
  sedeEfectiva: SedeEntrega;
  fecha: string;
  receptor: string;
  registradoPor: { codusu: string; nombre: string };
  observacion: string | null;
  documentosPendientes: boolean;
  observacionDocumentos: string | null;
  referenciaGuia: string | null;
  decisionTecho: { decision: 'Sin techo' | 'Con techo'; codtte: string | null };
  estado: 'Entregada';
  registradoEn: string;
}

export interface CondicionesPreparacionEntrega {
  armado: string;
  techo: string;
}

export interface EstadoEntregaResultado {
  codven: string;
  coduni: string;
  codcli: string;
  estadoVenta: string;
  estado: 'Vendida pendiente de entrega' | 'Lista para entrega' | 'Lista para entrega embalada' | 'Entregada' | 'Venta cancelada';
  modalidadAcordada?: ModalidadEntrega | null;
  sedeAcordada?: SedeEntrega | null;
  ubicacionActual?: { codubi: string; sede: string } | null;
  decisionTecho?: string | null;
  preparacion?: CondicionesPreparacionEntrega | null;
  entrega: EntregaRegistrada | null;
  condicionesFaltantes: string[];
}

export interface RegistrarEntregaResultado {
  conflicto: boolean;
  reutilizada: boolean;
  estado: 'Entregada';
  entrega?: EntregaRegistrada;
  mensaje?: string;
  entregaExistente?: EntregaRegistrada;
}

export interface ErrorEntregaBD {
  code?: string;
}
