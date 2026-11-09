import { ErrorHttp } from './errores';
import type { BuscarLeadsInput } from '../types/lead.busqueda.types';

export function validarBusquedaLeads(query: unknown): BuscarLeadsInput {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new ErrorHttp(400, 'Parámetros de búsqueda inválidos');
  const datos = query as Record<string, unknown>;
  const extra = Object.keys(datos).find(campo => campo !== 'buscar');
  if (extra) throw new ErrorHttp(400, `Parámetro no permitido: ${extra}`);

  const valor = datos.buscar;
  if (typeof valor !== 'string') throw new ErrorHttp(400, 'buscar debe ser texto');
  const p_buscar = valor.trim().replace(/\s+/g, ' ');
  const digitos = p_buscar.replace(/\D/g, '');
  const esBusquedaTelefono = !/[A-Za-zÀ-ÿ]/.test(p_buscar) && digitos.length > 0;
  if (!p_buscar || [...p_buscar].length < 2 || [...p_buscar].length > 100
    || /[\u0000-\u001f\u007f]/.test(p_buscar)
    || (esBusquedaTelefono && digitos.length < 3)) {
    throw new ErrorHttp(400, 'buscar debe tener entre 2 y 100 caracteres; para celular ingresa al menos 3 dígitos');
  }
  return { p_buscar };
}
