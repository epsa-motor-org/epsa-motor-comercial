import type { EntregaRegistrada } from './entrega.types';

export interface RegistrarRetornoRequest {
  fechaRetorno: string;
  codubi: number;
  condicion: string;
  observacion: string;
}

export interface RegistrarRetornoInput {
  p_codven: string;
  p_fecharetorno: string;
  p_codubi: string;
  p_condicion: string;
  p_observacion: string;
  p_idempotencia: string;
}

export interface RetornoRegistrado {
  codretorno: string;
  codven: string;
  coduni: string;
  codentrega: string;
  fechaRetorno: string;
  ubicacion: { codubi: string; nombre: string; tipo: string };
  condicion: string;
  observacion: string;
  registradoPor: { codusu: string; nombre: string };
  registradoEn: string;
  estadoComercialResultante: 'Disponible' | 'Separada' | 'Vendida';
}

export interface RetornoResultado {
  estado: 'Retornada';
  venta: { codven: string; estado: 'Cancelada' };
  entrega: EntregaRegistrada;
  retorno: RetornoRegistrado;
  ubicacionActual: { codubi: string; nombre: string; tipo: string } | null;
  estadoComercialUnidad: 'Disponible' | 'Separada' | 'Vendida';
  reutilizada: boolean;
}

export interface ErrorRetornoBD {
  code?: string;
}
