// Foto del modelo (con su color)
import { useState } from "react";
import MotoIllustration from "./MotoIllustration";
import { filtroEntre } from "../data/mockData";

export function fotoDeColor(modelo, color) {
  // HU-036: foto central subida o enlazada por HTTPS, tal cual (no se pinta otro color encima). Si se eligió un
  // color, se muestra la foto oficial de ese color; si no la hay, la oficial de otro color con su tono.
  if (modelo.sinTinte) {
    const fotos = modelo.fotosColor || {};
    if (color && fotos[color]) return { src: fotos[color], filtro: "" };
    const otra = color ? Object.entries(fotos).find(([, u]) => u) : null;
    if (otra) return { src: otra[1], filtro: filtroEntre(otra[0], color) };
    return { src: modelo.imagenApi || modelo.imagen, filtro: "" };
  }
  const c = color || modelo.colorPortada || modelo.colores?.[0];
  const propia = c && modelo.fotosColor?.[c];
  if (propia) return { src: propia, filtro: "" };
  const conRoja = modelo.fotosColor?.Rojo;
  const src = conRoja || modelo.imagenApi || modelo.imagen;
  const colorDeLaFoto = conRoja ? "Rojo" : modelo.colorFoto || "Rojo";
  return { src, filtro: filtroEntre(colorDeLaFoto, c) };
}

// Hasta n modelos sin repetir la misma foto (primero uno por familia, para que haya variedad)
export function motosConFotoDistinta(modelos = [], n = 3) {
  const fotos = new Set();
  const familias = new Set();
  const elegir = (m) => { const src = fotoDeColor(m).src; if (!src || fotos.has(src)) return false; fotos.add(src); return true; };
  const primero = modelos.filter((m) => !familias.has(m.familia) && familias.add(m.familia) && elegir(m));
  const resto = modelos.filter((m) => !primero.includes(m) && elegir(m));
  return [...primero, ...resto].slice(0, n);
}

export default function ModeloImg({ modelo, color, className = "", alt }) {
  const { src, filtro } = fotoDeColor(modelo, color);
  const fuentes = [...new Set([src, modelo.imagenApi || modelo.imagen, modelo.local].filter(Boolean))];
  const [paso, setPaso] = useState({ clave: "", n: 0 });
  const clave = fuentes.join("|");
  const n = paso.clave === clave ? paso.n : 0;
  if (n >= fuentes.length) return <MotoIllustration className={`${className} p-4 opacity-30`} />;
  return (
    <img
      key={fuentes[n]}
      src={fuentes[n]}
      alt={alt ?? `${modelo.nombre}${color ? ` color ${color}` : ""}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setPaso({ clave, n: n + 1 })}
      className={`${className} transition-[filter] duration-300`}
      style={filtro && n === 0 ? { filter: filtro } : undefined}
      data-color={color || ""}
    />
  );
}
