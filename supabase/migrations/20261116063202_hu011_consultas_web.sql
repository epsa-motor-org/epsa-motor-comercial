BEGIN;

-- Un acuse opaco por envío. No es un cliente, reserva, venta ni seguimiento.
CREATE TABLE IF NOT EXISTS public.hu011_envio_web (
  id uuid PRIMARY KEY,
  codlea bigint NOT NULL UNIQUE REFERENCES public.lead(codlea),
  huella text NOT NULL CHECK (length(huella) = 64),
  modalidad text NOT NULL CHECK (modalidad IN ('Cotización','Consulta general')),
  version_aviso text NOT NULL,
  aceptado_en timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.hu011_envio_web ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hu011_envio_web FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_hu011_envio_fecha ON public.hu011_envio_web(aceptado_en);

-- Cerrar el contrato legado de siete argumentos: no puede eludir consentimiento
-- ni fusionar consultas de un mismo teléfono durante 24 h.
DO $$ BEGIN
  IF to_regprocedure('public.web_registrar_interesado(text,text,bigint,text,bigint,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.web_registrar_interesado(text,text,bigint,text,bigint,text,text)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.web_registrar_interesado(
  p_nombre text, p_telefono text, p_codmod bigint, p_color text,
  p_codsed bigint, p_detalle text, p_tipo text, p_idempotencia uuid,
  p_acepta boolean, p_version_aviso text, p_contexto text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  nombre text; telefono text; mensaje text; color text; contexto text;
  huella text; envio public.hu011_envio_web%ROWTYPE; nuevo bigint;
BEGIN
  nombre := btrim(regexp_replace(pg_catalog.normalize(coalesce(p_nombre,''),'NFC'), '[[:space:]]+', ' ', 'g'));
  telefono := regexp_replace(coalesce(p_telefono,''), '[^0-9]', '', 'g');
  IF btrim(coalesce(p_telefono,'')) LIKE '+%' AND telefono !~ '^519[0-9]{8}$' THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='El prefijo del celular debe ser +51.';
  END IF;
  IF telefono ~ '^519[0-9]{8}$' THEN telefono := substr(telefono,3); END IF;
  mensaje := btrim(regexp_replace(coalesce(p_detalle,''), '[[:space:]]+', ' ', 'g'));
  contexto := btrim(regexp_replace(coalesce(p_contexto,''), '[[:space:]]+', ' ', 'g'));
  color := nullif(btrim(coalesce(p_color,'')), '');
  IF p_idempotencia IS NULL OR p_acepta IS DISTINCT FROM true OR p_version_aviso IS DISTINCT FROM '2026-10' THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Confirma el aviso de datos vigente y vuelve a enviar.';
  END IF;
  IF char_length(nombre) NOT BETWEEN 2 AND 150 OR coalesce(p_nombre,'') ~ '[[:cntrl:]]'
    OR nombre !~ '^[[:alpha:] ''’-]+$' OR nombre !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Escribe un nombre válido de 2 a 150 caracteres.';
  END IF;
  IF btrim(coalesce(p_telefono,'')) !~ '^\+?[0-9 ().-]+$' OR telefono !~ '^9[0-9]{8}$' THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Escribe un celular peruano de 9 dígitos que empiece con 9.';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('Cotización','Consulta general')
    OR (p_tipo='Consulta general' AND mensaje='') OR char_length(mensaje)>500
    OR char_length(contexto)>300 OR char_length(color)>50 THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Revisa la modalidad y el mensaje (máximo 500 caracteres).';
  END IF;
  IF coalesce(p_detalle,'') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    OR coalesce(p_contexto,'') ~ '[[:cntrl:]]' OR coalesce(p_color,'') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='El texto contiene caracteres de control.';
  END IF;
  huella := encode(sha256(convert_to(jsonb_build_array(nombre,telefono,p_codmod,color,p_codsed,mensaje,p_tipo,p_version_aviso,contexto)::text,'UTF8')),'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotencia::text,11));
  SELECT * INTO envio FROM public.hu011_envio_web WHERE id=p_idempotencia;
  IF FOUND THEN
    IF envio.huella<>huella THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Ese identificador de envío ya se usó con otros datos.';
    END IF;
    RETURN jsonb_build_object('codigo','W-'||envio.id::text,'repetido',true);
  END IF;
  IF (p_tipo='Cotización' AND p_codmod IS NULL) OR (p_codmod IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.modelo WHERE codmod=p_codmod AND estmod='Publicado' FOR SHARE
  )) THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Elige un modelo publicado para la cotización.';
  END IF;
  IF p_codsed IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sede s JOIN public.ubicacion u ON u.codubi=s.codubi
    WHERE s.codsed=p_codsed AND s.estsed AND u.estubi AND u.tipubi='Sede'
      AND lower(btrim(u.nomubi)) IN ('comas','puente piedra','ventanilla') FOR SHARE OF s,u
  ) THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Elige una sede de atención activa de EPSA.';
  END IF;
  -- Conserva el freno global legado, aplicado transaccionalmente y después del
  -- replay. No bloquea todas las consultas de una persona por su teléfono.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hu011:ventana',11));
  IF (SELECT count(*) FROM public.hu011_envio_web WHERE aceptado_en>CURRENT_TIMESTAMP-interval '10 minutes')>=40 THEN
    RAISE EXCEPTION USING ERRCODE='PT429', MESSAGE='Recibimos muchas solicitudes. Inténtalo en unos minutos.';
  END IF;
  INSERT INTO public.lead(codmod,codusu,codcwa,nomlea,tellea,orilea,canlea,obslea,estlea,codsed,collea,tipreglea,codcli,codcrelea)
  VALUES(p_codmod,NULL,NULL,nombre,telefono,'Web','Web',
    concat_ws(E'\n',p_tipo||CASE WHEN mensaje<>'' THEN ': '||mensaje ELSE '' END,
      nullif(contexto,''),CASE WHEN color IS NOT NULL THEN 'Color de interés: '||color END),
    'Nuevo',p_codsed,CASE WHEN color IN ('Rojo','Azul','Amarillo','Verde','Negro') THEN color END,'Web',NULL,NULL)
  RETURNING codlea INTO nuevo;
  INSERT INTO public.hu011_envio_web(id,codlea,huella,modalidad,version_aviso)
    VALUES(p_idempotencia,nuevo,huella,p_tipo,p_version_aviso);
  RETURN jsonb_build_object('codigo','W-'||p_idempotencia::text,'repetido',false);
END $$;
REVOKE ALL ON FUNCTION public.web_registrar_interesado(text,text,bigint,text,bigint,text,text,uuid,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_registrar_interesado(text,text,bigint,text,bigint,text,text,uuid,boolean,text,text) TO anon,authenticated;

COMMIT;
