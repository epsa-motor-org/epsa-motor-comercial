// HU-036 · Galería aplicada al catálogo (sin depender del store para evitar ciclos)
export const ordenarFotos = (a, b) => a.orden - b.orden || a.id - b.id;
const ordenar = ordenarFotos;

// Galería aplicada al catálogo: foto principal, una foto por color y la tira de fotos de la web
export function aplicarGaleria(modelos, imagenes, urls = {}, editadas = {}) {
  if (!imagenes?.length) return modelos;
  const porModelo = {};
  for (const i of imagenes) if (i.activa) (porModelo[i.modelo] ||= []).push(i);
  return modelos.map((m) => {
    const fotos = (porModelo[m.id] || []).sort(ordenar).map((i) => ({ ...i, src: i.url || urls[i.archivo] || "" })).filter((i) => i.src);
    if (!fotos.length) return m;
    const galeria = fotos.map((i) => ({ id: i.id, src: i.src, color: i.color, principal: i.principal }));
    // Si nadie tocó las fotos de este modelo, la web sigue igual que antes
    if (!editadas[m.id]) return { ...m, galeria };
    const principal = fotos.find((i) => i.principal) || fotos[0];
    const fotosColor = {};
    for (const i of fotos) if (i.color && !fotosColor[i.color]) fotosColor[i.color] = i.src;
    return { ...m, galeria, imagen: principal.src, colorFoto: principal.color || m.colorFoto, fotosColor, fotoPropia: true };
  });
}


// HU-036 · Con la base conectada mandan las fotos centrales (activas y en su orden).
// Si la principal es una de las fotos oficiales que ya usaba la web (Sprint 1), la ficha sigue igual: fotos por
// color y tono. Si es una foto subida al almacenamiento central o una URL HTTPS nueva, se muestra tal cual,
// sin pintar colores encima. Las fotos oficiales por color de la ficha técnica se conservan: al elegir un color
// en la web se muestra la foto de ese color (antes se descartaban y los botones de color no cambiaban la foto).
export function aplicarFotosCentrales(m, imagenes = []) {
  const activas = [...(imagenes || [])].filter((i) => i && i.urlimo && i.estimo !== false)
    .sort((a, b) => (a.ordimo ?? 0) - (b.ordimo ?? 0) || (Number(a.codimo) || 0) - (Number(b.codimo) || 0));
  const principal = activas[0]?.urlimo;
  if (!principal) return { ...m, imagenApi: undefined };
  const galeria = activas.map((i, n) => ({ id: `api-${i.codimo ?? n}`, src: i.urlimo }));
  const oficiales = new Set([m.imagen, m.local, ...Object.values(m.fotosColor || {})].filter(Boolean));
  if (!oficiales.has(principal)) {
    return { ...m, imagenApi: principal, imagen: principal, fotosColor: m.fotosColor || {}, sinTinte: true, fotoPropia: false, galeria };
  }
  return { ...m, imagenApi: principal, fotoPropia: false, galeria: activas.length > 1 ? galeria : m.galeria };
}
