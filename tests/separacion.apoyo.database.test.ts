import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// HU-005 · Complemento de base: tipos de documento, comprador, datos del formulario y captura en Storage.

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface Comprador {
  codcli: string; codtdo: string; tipoDocumento: string; numeroDocumento: string; nombres: string;
  apellidoPaterno: string | null; apellidoMaterno: string | null; telefono: string | null; correo: string | null;
  activo: boolean; existente?: boolean;
}
interface Participante { codusu: string; nombre: string; rol?: string }
interface Formulario {
  usuarioActual: { codusu: string; rol: string };
  tiposDocumento: { codtdo: string; nombre: string }[];
  responsables: Participante[];
  gerentes: Participante[];
}

const migraciones = [
  '202610030001_hu026_ubicaciones.sql',
  '202610040001_hu034_compra_pendiente.sql',
  '202610060001_hu002_identificacion_unidades.sql',
  '202610070001_hu007_permisos_rol.sql',
  '202611050001_hu005_separacion_moto.sql',
  '202611060001_hu005_confirmador_transferencia.sql'
].map(nombre => readFileSync(`supabase/migrations/${nombre}`, 'utf8'));
const complemento = readFileSync('supabase/migrations/202611070001_hu005_comprador_evidencia.sql', 'utf8');

// Usuarios: 1 Gerente, 2 Administradora, 3 Vendedor, 4 Auxiliar, 5 cuenta interna (Administradora @epsa.internal), 6 Gerente inactivo
const uuids = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-00000000000${i + 1}`);

test('HU-005 PostgreSQL: comprador, formulario y captura verificada', async t => {
  const db = new PGlite();
  let usuarioActual = 1;
  async function login(numero = usuarioActual) {
    usuarioActual = numero;
    await db.exec("RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','" + uuids[numero - 1] + "',false)");
  }
  async function administrativo<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec('RESET ROLE');
    try { return await fn(); } finally { await login(usuarioActual); }
  }
  const escalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await db.query<Valor<T>>(sql, params)).rows[0].r;
  const registrar = (codtdo: number, numero: string, nombres: string, paterno: string | null = null,
    materno: string | null = null, telefono: string | null = null, correo: string | null = null) =>
    escalar<Comprador>('SELECT public.hu005_registrar_cliente($1,$2,$3,$4,$5,$6,$7) r',
      [codtdo, numero, nombres, paterno, materno, telefono, correo]);
  const tipo = (nombre: string) => administrativo(() =>
    escalar<number>('SELECT codtdo::int r FROM public.tipodocumento WHERE nomtdo=$1', [nombre]));
  const error = (codigo: string, mensaje?: RegExp) => (e: unknown) =>
    (e as ErrorSQL).code === codigo && (!mensaje || mensaje.test((e as ErrorSQL).message ?? ''));
  async function crearUnidad(etiqueta: string): Promise<string> {
    return administrativo(async () => {
      const compra = (await db.query<{ codcom: string }>(
        "INSERT INTO public.compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',1) RETURNING codcom::text")).rows[0].codcom;
      await db.query("INSERT INTO public.factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) "
        + "VALUES ($1,'QA',$2,'2026-11-01',1,1)", [compra, 'FAC-' + etiqueta]);
      return (await db.query<{ coduni: string }>(
        "INSERT INTO public.unidad(codcom,codmod,codubi,codtte,codpro,codepr,nummotuni,chauni,coluni,estcomuni) "
          + "VALUES ($1,1,1,1,1,1,$2,$3,'Azul','No disponible') RETURNING coduni::text",
        [compra, 'MOTOR-' + etiqueta, 'CHASIS-' + etiqueta])).rows[0].coduni;
    });
  }
  const subir = (ruta: string) => db.query(
    "INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('separaciones-evidencia',$1,auth.uid())", [ruta]);
  const separar = (coduni: string, codcli: string, medio: string, ruta: string | null) => escalar<{ estado: string; rutaEvidencia: string | null }>(
    'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r',
    [coduni, codcli, 3, medio === 'Transferencia' ? 1 : null, 300, '2026-11-07', medio,
      medio === 'Transferencia' ? 'OP-778899' : null, ruta,
      medio === 'Efectivo' ? 'Efectivo recibido en tienda, recibo 0012' : null, true, randomUUID()]);

  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA storage; "
      + "CREATE TABLE auth.users(id uuid PRIMARY KEY); "
      + "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS "
      + "$$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; "
      + "CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, "
      + "file_size_limit bigint, allowed_mime_types text[]); "
      + "CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), "
      + "name text NOT NULL, owner uuid, UNIQUE(bucket_id,name)); "
      + "CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS "
      + "$$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$; "
      + "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; "
      + "GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated; "
      + "GRANT SELECT,INSERT ON storage.objects TO authenticated; "
      + "GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;");
    await db.exec(readFileSync('tests/fixtures/esquema-base.sql', 'utf8'));
    for (const [i, sql] of migraciones.entries()) {
      if (i === 4) await db.exec("ALTER TABLE public.separacion ENABLE ROW LEVEL SECURITY; "
        + "ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY; "
        + "GRANT ALL ON public.separacion,public.venta TO authenticated; "
        + "GRANT USAGE,SELECT ON SEQUENCE public.separacion_codsep_seq TO authenticated;");
      await db.exec(sql);
    }
    await db.exec(complemento);
    await db.exec(complemento); // la migración se puede volver a ejecutar sin duplicar nada

    await db.exec("INSERT INTO auth.users(id) VALUES " + uuids.map(id => `('${id}')`).join(',') + "; "
      + "INSERT INTO public.rol(nomrol,estrol) VALUES ('Gerente',true),('Administradora',true),('Vendedor',true),('Auxiliar',true); "
      + "INSERT INTO public.usuario(uuidusu,codrol,nomusu,apepatusu,apematusu,corusu,estusu) VALUES "
      + `('${uuids[0]}',1,'Flavio','Ramos','','flavio@qa.test',true),`
      + `('${uuids[1]}',2,'Deysi','Torres','Vega','deysi@qa.test',true),`
      + `('${uuids[2]}',3,'Cesar','Lopez',NULL,'cesar@qa.test',true),`
      + `('${uuids[3]}',4,'Ana','Auxiliar',NULL,'ana@qa.test',true),`
      + `('${uuids[4]}',2,'Integracion','Facturas',NULL,'integracion.facturas@epsa.internal',true),`
      + `('${uuids[5]}',1,'Gerente','Inactivo',NULL,'inactivo@qa.test',false); `
      + "INSERT INTO public.tipomotocar(nomtmo) VALUES ('Modelo QA'); "
      + "INSERT INTO public.modelo(codtmo,nommod,desmod,carmod) VALUES (1,'Modelo QA','Descripción','Características'); "
      + "INSERT INTO public.tipotecho(nomtte) VALUES ('Techo QA'); "
      + "INSERT INTO public.proveedor(nompro) VALUES ('Proveedor QA'); "
      + "INSERT INTO public.estadopreparacion(nomepr) VALUES ('Preparación QA');");

    await t.test('Catálogo de tipos de documento y bucket privado sin duplicados', async () => {
      const tipos = await escalar<string[]>('SELECT array_agg(nomtdo ORDER BY codtdo) r FROM public.tipodocumento');
      assert.deepEqual(tipos, ['DNI', 'RUC', 'Carné de extranjería', 'Pasaporte']);
      const bucket = await escalar<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
        "SELECT to_jsonb(b) r FROM storage.buckets b WHERE id='separaciones-evidencia'");
      assert.equal(bucket.public, false);
      assert.equal(Number(bucket.file_size_limit), 5 * 1024 * 1024);
      assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    });

    await t.test('Formulario: los tres roles lo reciben; sin cuenta interna ni usuarios inactivos', async () => {
      for (const [numero, rol] of [[1, 'Gerente'], [2, 'Administradora'], [3, 'Vendedor']] as const) {
        await login(numero);
        const f = await escalar<Formulario>('SELECT public.hu005_formulario_separacion() r');
        assert.deepEqual(f.usuarioActual, { codusu: String(numero), rol });
        assert.deepEqual(f.responsables.map(r => r.nombre), ['Cesar Lopez', 'Deysi Torres Vega', 'Flavio Ramos']);
        assert.deepEqual(f.gerentes, [{ codusu: '1', nombre: 'Flavio Ramos' }]);
        assert.equal(f.tiposDocumento.length, 4);
      }
      for (const numero of [4, 6]) {
        await login(numero);
        await assert.rejects(db.query('SELECT public.hu005_formulario_separacion()'), error('42501'));
        await assert.rejects(db.query("SELECT public.hu005_buscar_cliente('45879632')"), error('42501'));
      }
    });

    await t.test('Comprador: registra DNI, normaliza, no duplica y busca por documento', async () => {
      await login(3);
      assert.equal(await escalar('SELECT public.hu005_buscar_cliente($1) r', ['45879632']), null);
      const dni = await tipo('DNI');
      const nuevo = await registrar(dni, ' 4587-9632 ', '  Rosa   María ', 'Quispe', 'Huamán', '987 654 321', ' Rosa.Q@Correo.PE ');
      assert.equal(nuevo.existente, false);
      assert.equal(nuevo.numeroDocumento, '45879632');
      assert.equal(nuevo.nombres, 'Rosa María');
      assert.equal(nuevo.correo, 'rosa.q@correo.pe');
      assert.equal(nuevo.activo, true);
      const repetido = await registrar(dni, '45879632', 'Otro Nombre', 'Otro');
      assert.equal(repetido.existente, true);
      assert.equal(repetido.codcli, nuevo.codcli);
      assert.equal(repetido.nombres, 'Rosa María'); // no se sobrescribe un cliente existente
      const buscado = await escalar<Comprador>('SELECT public.hu005_buscar_cliente($1) r', ['45879632']);
      assert.equal(buscado.codcli, nuevo.codcli);
      assert.equal(buscado.tipoDocumento, 'DNI');
      assert.equal(await administrativo(() => escalar<number>("SELECT count(*)::int r FROM public.cliente WHERE numdoccli='45879632'")), 1);
    });

    await t.test('Comprador: empresa con RUC 20 guarda razón social sin apellidos', async () => {
      await login(2);
      const empresa = await registrar(await tipo('RUC'), '20512345678', 'Transportes Ancón S.A.C.', 'Ignorado');
      assert.equal(empresa.nombres, 'Transportes Ancón S.A.C.');
      assert.equal(empresa.apellidoPaterno, null);
      const natural = await registrar(await tipo('RUC'), '10458796321', 'Luis', 'Paredes');
      assert.equal(natural.apellidoPaterno, 'Paredes');
    });

    await t.test('Comprador: rechaza datos inválidos con mensajes claros', async () => {
      await login(3);
      const dni = await tipo('DNI');
      await assert.rejects(registrar(dni, '4587963', 'Rosa', 'Quispe'), error('PT400', /no corresponde al tipo/));
      await assert.rejects(registrar(await tipo('RUC'), '30512345678', 'Empresa', null), error('PT400', /no corresponde al tipo/));
      await assert.rejects(registrar(999, '45879000', 'Rosa', 'Quispe'), error('PT400', /Tipo de documento/));
      await assert.rejects(registrar(dni, '45879001', 'R0sa', 'Quispe'), error('PT400', /Nombre/));
      await assert.rejects(registrar(dni, '45879002', 'Rosa', null), error('PT400', /Apellido paterno/));
      await assert.rejects(registrar(dni, '45879003', 'Rosa', 'Quispe', null, '12ab'), error('PT400', /Teléfono/));
      await assert.rejects(registrar(dni, '45879004', 'Rosa', 'Quispe', null, null, 'sin-arroba'), error('PT400', /Correo/));
      await assert.rejects(db.query("SELECT public.hu005_buscar_cliente('12')"), error('PT400'));
      await login(4);
      await assert.rejects(registrar(dni, '45879005', 'Rosa', 'Quispe'), error('42501'));
    });

    await t.test('Funciones internas y tablas no quedan abiertas al usuario', async () => {
      await login(3);
      await assert.rejects(db.query('SELECT public.hu005_proyectar_cliente(1)'), error('42501'));
      await db.exec('RESET ROLE; SET ROLE anon');
      await assert.rejects(db.query('SELECT public.hu005_formulario_separacion()'), error('42501'));
      await login(3);
    });

    await t.test('Storage: solo los tres roles suben, y solo dentro de separaciones/', async () => {
      const unidad = await crearUnidad('STORAGE');
      for (const numero of [1, 2, 3]) {
        await login(numero);
        await subir(`separaciones/${unidad}/${randomUUID()}.png`);
      }
      await login(3);
      await assert.rejects(subir(`otra-carpeta/${unidad}/${randomUUID()}.png`), error('42501'));
      await login(4);
      await assert.rejects(subir(`separaciones/${unidad}/${randomUUID()}.png`), error('42501'));
      await login(3);
      assert.equal(await escalar<number>("SELECT count(*)::int r FROM storage.objects WHERE bucket_id='separaciones-evidencia'"), 3);
      await login(4);
      assert.equal(await escalar<number>("SELECT count(*)::int r FROM storage.objects WHERE bucket_id='separaciones-evidencia'"), 0);
    });

    await t.test('Transferencia: exige que la captura exista en la carpeta de esa moto; efectivo no la pide', async () => {
      await login(3);
      const cliente = (await registrar(await tipo('DNI'), '70112233', 'Jorge', 'Salas')).codcli;
      const moto = await crearUnidad('TRANSFER');
      const otra = await crearUnidad('OTRA');
      await assert.rejects(separar(moto, cliente, 'Transferencia', `separaciones/${moto}/no-existe.png`), error('PT434'));
      const ajena = `separaciones/${otra}/${randomUUID()}.png`;
      await subir(ajena);
      await assert.rejects(separar(moto, cliente, 'Transferencia', ajena), error('PT434'));
      assert.equal(await administrativo(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [moto])), 'No disponible');
      const propia = `separaciones/${moto}/${randomUUID()}.pdf`;
      await subir(propia);
      const ok = await separar(moto, cliente, 'Transferencia', propia);
      assert.equal(ok.estado, 'Activa');
      assert.equal(ok.rutaEvidencia, propia);
      assert.equal(await administrativo(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [moto])), 'Separada');
      const efectivo = await separar(otra, cliente, 'Efectivo', null);
      assert.equal(efectivo.estado, 'Activa');

      const activa = await escalar<{
        comprador: Comprador; autor: { nombre: string }; responsable: { nombre: string };
        confirmador: { nombre: string }; medioPago: string; rutaEvidencia: string; monto: number; estado: string;
      }>('SELECT public.hu005_separacion_activa($1) r', [moto]);
      assert.equal(activa.comprador.nombres, 'Jorge');
      assert.equal(activa.autor.nombre, 'Cesar Lopez');
      assert.equal(activa.responsable.nombre, 'Cesar Lopez');
      assert.equal(activa.confirmador.nombre, 'Flavio Ramos');
      assert.equal(activa.medioPago, 'Transferencia');
      assert.equal(activa.rutaEvidencia, propia);
      assert.equal(Number(activa.monto), 300);
      const enEfectivo = await escalar<{ confirmador: { nombre: string }; observacion: string }>('SELECT public.hu005_separacion_activa($1) r', [otra]);
      assert.equal(enEfectivo.confirmador.nombre, 'Cesar Lopez');
      assert.match(enEfectivo.observacion, /recibo 0012/);
      const sinSeparar = await crearUnidad('LIBRE');
      assert.equal(await escalar('SELECT public.hu005_separacion_activa($1) r', [sinSeparar]), null);
      await login(4);
      await assert.rejects(db.query('SELECT public.hu005_separacion_activa($1)', [moto]), error('42501'));
      await login(3);
    });
  } finally {
    await db.close();
  }
});
