// Contrato HU-011 público. No reutiliza permisos ni mínimos del alta manual.
export const MAX_MENSAJE = 500;
export const normalizarTexto = (v) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const controlInvalido = (v, saltos = false) => [...String(v ?? '')].some((c) => {
  const n = c.codePointAt(0);
  return n === 127 || (n < 32 && !(saltos && [9, 10, 13].includes(n)));
});
export function normalizarCelular(v) {
  const t = String(v ?? '').replace(/^ +| +$/g, '');
  if (!/^\+?[0-9 ().-]+$/.test(t)) return null;
  let n = t.replace(/\D/g, '');
  if (t.startsWith('+') && !/^519\d{8}$/.test(n)) return null;
  if (/^519\d{8}$/.test(n)) n = n.slice(2);
  return /^9\d{8}$/.test(n) ? n : null;
}
export function erroresConsultaWeb(f) {
  const e = {}, nombre = normalizarTexto(f.nombre), mensaje = normalizarTexto(f.mensaje);
  if ([...nombre].length < 2 || [...nombre].length > 150 || controlInvalido(f.nombre) || !/^[\p{L} '\u2019-]+$/u.test(nombre) || !/\p{L}/u.test(nombre)) e.nombre = 'Escribe un nombre válido de 2 a 150 caracteres.';
  if (!normalizarCelular(f.telefono)) e.telefono = 'Escribe un celular peruano de 9 dígitos que empiece con 9. Puedes incluir +51.';
  if (!f.sede) e.sede = 'Elige una sede de atención.';
  if (!['consulta', 'cotizar'].includes(f.tipo)) e.general = 'Elige el tipo de consulta.';
  if (f.tipo === 'cotizar' && !f.modelo) e.modelo = 'Elige un modelo.';
  if (f.tipo === 'consulta' && !mensaje) e.mensaje = 'Escribe tu consulta.';
  if ([...mensaje].length > MAX_MENSAJE) e.mensaje = `Máximo ${MAX_MENSAJE} caracteres.`;
  if (controlInvalido(f.mensaje, true)) e.mensaje = 'El mensaje contiene caracteres de control.';
  if (f.acepta !== true) e.acepta = 'Para responderte necesitamos tu autorización.';
  return e;
}
// Igual payload canónico conserva la clave incluso tras perder la respuesta.
export function intentoConsulta(anterior, cuerpo, uuid = () => crypto.randomUUID()) {
  const firma = JSON.stringify(cuerpo);
  return anterior?.firma === firma ? anterior : { firma, id: uuid() };
}
