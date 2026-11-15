import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface Ubicaciones { ancon: string; fivesa: string; comas: string; inactiva: string }
interface Actor { nombre: string; }
interface Movimiento {
  codmub: string; coduni: string; estado: string;
  origen: { codubi: string; nomubi: string };
  destino: { codubi: string; nomubi: string };
  fechaSalida: string; horaSalida: string; autorSalida: Actor | null;
  fechaRecepcion: string | null; horaRecepcion: string | null; autorRecepcion: Actor | null;
  observacion: string | null;
}
interface EstadoUnidad {
  coduni: string;
  ubicacionConfirmada: { codubi: string; nomubi: string } | null;
  movimientoActivo: Movimiento | null;
  movimientos: Movimiento[];
}
interface Operativo { estcomuni: string; codepr: number | null; codtte: number | null; codpro: number | null; codubi: number | null }
interface Conteo { total: number }

const migracionHu003 = readFileSync('supabase/migrations/202610190001_hu003_movimientos_ubicacion.sql', 'utf8');
const fixture = readFileSync('tests/fixtures/esquema-base.sql', 'utf8');
const migracionHu026 = readFileSync('supabase/migrations/202610030001_hu026_ubicaciones.sql', 'utf8');
const migracionHu034 = readFileSync('supabase/migrations/202610040001_hu034_compra_pendiente.sql', 'utf8');
const migracionHu002 = readFileSync('supabase/migrations/202610060001_hu002_identificacion_unidades.sql', 'utf8');
const migracionHu007 = readFileSync('supabase/migrations/202610070001_hu007_permisos_rol.sql', 'utf8');

async function preparar(db: PGlite, completo: boolean) {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await db.exec(fixture);
  await db.exec("INSERT INTO ubicacion(nomubi,tipubi) VALUES ('Crossland Ancon','Almacen')");
  await db.exec(migracionHu026);
  if (completo) {
    await db.exec(migracionHu034);
    await db.exec(migracionHu002);
    await db.exec(migracionHu007);
  }
  await db.exec(`INSERT INTO auth.users VALUES
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002'),
      ('00000000-0000-0000-0000-000000000003');
    INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor');
    INSERT INTO usuario(uuidusu,codrol,nomusu,apepatusu,corusu)
      SELECT id, row_number() OVER (ORDER BY id),
        CASE row_number() OVER (ORDER BY id) WHEN 1 THEN 'Gerente' WHEN 2 THEN 'Administradora' ELSE 'Vendedor' END,
        'QA', id::text || '@test.local' FROM auth.users;
    INSERT INTO tipomotocar(nomtmo) VALUES ('QA');
    INSERT INTO modelo(codtmo,nommod,desmod,carmod) VALUES (1,'Modelo QA','Descripción','Características');`);
  if (completo) {
    await db.exec(`GRANT ALL ON public.movimientoubicacion TO anon, authenticated;
      GRANT USAGE, SELECT ON SEQUENCE public.movimientoubicacion_codmub_seq TO anon, authenticated;`);
    await db.exec(migracionHu003);
  }
}

function crearHerramientas(db: PGlite) {
  let usuario = 1;
  const error = (codigo: string) => (e: unknown) => (e as ErrorSQL).code === codigo;
  const login = async (n = usuario) => {
    usuario = n;
    await db.exec(`RESET ROLE; SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000${n}',false)`);
  };
  async function administrativo<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec('RESET ROLE');
    try { return await fn(); } finally { await login(usuario); }
  }
  async function escalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    return (await db.query<Valor<T>>(sql, params)).rows[0].r;
  }
  async function escalarAdmin<T>(sql: string, params: unknown[] = []): Promise<T> {
    return administrativo(() => escalar<T>(sql, params));
  }
  async function crearUnidad(etiqueta: string, codubi: string | null): Promise<string> {
    return administrativo(async () => {
      const codcom = (await db.query<{ codcom: string }>(
        `INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',1) RETURNING codcom::text`, []
      )).rows[0].codcom;
      await db.query(`INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu)
        VALUES ($1,'QA','F-${etiqueta}','2026-10-19',1,1)`, [codcom]);
      return (await db.query<{ coduni: string }>(
        `INSERT INTO unidad(codcom,codmod,codubi,nummotuni,chauni,coluni)
          VALUES ($1,1,$2,$3,$4,'Azul') RETURNING coduni::text`,
        [codcom, codubi, `M-${etiqueta}`, `C-${etiqueta}`]
      )).rows[0].coduni;
    });
  }
  async function ubicaciones(): Promise<Ubicaciones> {
    const rows = (await db.query<{ codubi: string; nomubi: string }>(
      `SELECT codubi::text, nomubi FROM ubicacion WHERE nomubi IN ('Crossland Ancón','FIVESA','Comas') ORDER BY nomubi`
    )).rows;
    const ids = Object.fromEntries(rows.map(row => [row.nomubi, row.codubi]));
    const inactiva = await administrativo(async () => {
      const id = (await db.query<{ codubi: string }>(
        `INSERT INTO ubicacion(nomubi,tipubi) VALUES ('Destino inactivo QA','Sede') RETURNING codubi::text`
      )).rows[0].codubi;
      await db.exec(`UPDATE ubicacion SET estubi=false WHERE codubi=${Number(id)}`);
      return id;
    });
    return { ancon: ids['Crossland Ancón'], fivesa: ids.FIVESA, comas: ids.Comas, inactiva };
  }
  return { login, administrativo, escalar, escalarAdmin, crearUnidad, ubicaciones, error };
}

test('HU-003 PostgreSQL: ciclo de movimientos, permisos, historial e integridad transaccional', async t => {
  const db = new PGlite();
  try {
    await preparar(db, true);
    const { login, administrativo, escalar, escalarAdmin, crearUnidad, ubicaciones, error } = crearHerramientas(db);
    const loc = await ubicaciones();
    const unidadGerente = await crearUnidad('GERENTE', loc.ancon);
    const unidadAdmin = await crearUnidad('ADMIN', loc.ancon);
    const unidadSinUbicacion = await crearUnidad('SIN-UBICACION', null);
    const unidadDesfasada = await crearUnidad('DESFASADA', loc.ancon);
    const unidadOperativa = await crearUnidad('OPERATIVA', loc.ancon);
    await administrativo(() => db.query(
      "UPDATE public.unidad SET estcomuni='Disponible' WHERE coduni=ANY($1::bigint[])", [[unidadGerente, unidadAdmin]]));
    let movimientoGerente = '';
    let movimientoAdmin = '';
    await login(1);

    await t.test('Gerente y Administradora pueden iniciar el traslado; estado queda En transito y codubi sigue en origen', async () => {
      const g = await escalar<Movimiento>('SELECT public.hu003_iniciar_movimiento($1,$2,$3,$4) r',
        [unidadGerente, loc.ancon, loc.fivesa, 'Traslado QA']);
      movimientoGerente = g.codmub;
      assert.equal(g.estado, 'En transito');
      assert.equal(g.origen.codubi, loc.ancon); assert.equal(g.destino.codubi, loc.fivesa);
      assert.equal(g.autorSalida?.nombre, 'Gerente QA');
      assert.equal(await escalarAdmin<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [unidadGerente]), 'Disponible',
        'iniciar un traslado no cambia la situación comercial de la unidad');
      const ubicacionG = await escalarAdmin<string>('SELECT codubi::text r FROM public.unidad WHERE coduni=$1', [unidadGerente]);
      assert.equal(ubicacionG, loc.ancon);

      await login(2);
      const a = await escalar<Movimiento>('SELECT public.hu003_iniciar_movimiento($1,$2,$3,$4) r',
        [unidadAdmin, loc.ancon, loc.comas, null]);
      movimientoAdmin = a.codmub;
      assert.equal(a.estado, 'En transito'); assert.equal(a.autorSalida?.nombre, 'Administradora QA');
      assert.equal(await escalarAdmin<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [unidadAdmin]), 'Disponible',
        'la segunda unidad también conserva su situación comercial');
      assert.equal(await escalarAdmin<string>('SELECT codubi::text r FROM public.unidad WHERE coduni=$1', [unidadAdmin]), loc.ancon);
    });

    await t.test('Vendedor no puede iniciar movimiento desde RPC', async () => {
      await login(3);
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadSinUbicacion, loc.ancon, loc.fivesa]), error('42501'));
      await login(1);
    });

    await t.test('origen obsoleto, origen=destino, unidad sin ubicación, destino inexistente/inactivo e ID inexistente se rechazan', async () => {
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadDesfasada, loc.comas, loc.fivesa]), error('PT409'));
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadDesfasada, loc.ancon, loc.ancon]), error('PT400'));
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadSinUbicacion, loc.ancon, loc.fivesa]), error('PT423'));
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadDesfasada, loc.ancon, '9223372036854775000']), error('PT404'));
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadDesfasada, loc.ancon, loc.inactiva]), error('PT422'));
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        ['9223372036854775000', loc.ancon, loc.fivesa]), error('PT404'));
    });

    await t.test('índice parcial y bloqueo de unidad impiden dos movimientos activos', async () => {
      await assert.rejects(escalar('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadGerente, loc.ancon, loc.comas]), error('PT424'));
      await assert.rejects(administrativo(() => db.exec(`INSERT INTO movimientoubicacion(coduni,codubiori,codubides,codusu,estmub)
        VALUES (${Number(unidadGerente)},${Number(loc.ancon)},${Number(loc.comas)},1,'En transito')`)), error('23505'));
    });

    await t.test('HU-026 sigue bloqueando origen y destino mientras el movimiento está activo', async () => {
      await assert.rejects(administrativo(() => db.exec(`UPDATE ubicacion SET estubi=false WHERE codubi=${Number(loc.ancon)}`)), error('PT409'));
      await assert.rejects(administrativo(() => db.exec(`UPDATE ubicacion SET estubi=false WHERE codubi=${Number(loc.fivesa)}`)), error('PT409'));
    });

    await t.test('Vendedor no puede confirmar recepción desde RPC', async () => {
      await login(3);
      await assert.rejects(escalar('SELECT public.hu003_confirmar_recepcion($1,$2) r',
        [unidadAdmin, movimientoAdmin]), error('42501'));
      await login(1);
    });

    await t.test('recepción válida finaliza, cambia codubi y guarda autor/fecha/hora sin alterar estados comerciales', async () => {
      await administrativo(async () => {
        await db.exec(`INSERT INTO tipotecho(nomtte) VALUES ('Techo QA');
          INSERT INTO estadopreparacion(nomepr) VALUES ('Preparación QA');
          INSERT INTO tipodocumento(nomtdo) VALUES ('DNI QA');
          INSERT INTO cliente(codtdo,numdoccli,nomcli) VALUES (1,'QA-CLIENTE','Cliente QA');
          UPDATE unidad SET estcomuni='Vendida', codtte=1, codepr=1 WHERE coduni=${Number(unidadGerente)};
          INSERT INTO separacion(coduni,codcli,codusu,metpagsep,monadesep,estsep)
            VALUES (${Number(unidadGerente)},1,1,'QA',20,'Activa');
          INSERT INTO venta(coduni,codcli,codusu,modcomven,estven)
            VALUES (${Number(unidadGerente)},1,1,'QA','Registrada');`);
      });
      const antes = await escalarAdmin<Operativo>(`SELECT jsonb_build_object(
        'estcomuni',estcomuni,'codepr',codepr,'codtte',codtte,'codpro',codpro,'codubi',codubi
      ) r FROM unidad WHERE coduni=$1`, [unidadGerente]);
      const separacionesAntes = await escalarAdmin<number>('SELECT count(*)::int r FROM separacion WHERE coduni=$1', [unidadGerente]);
      const ventasAntes = await escalarAdmin<number>('SELECT count(*)::int r FROM venta WHERE coduni=$1', [unidadGerente]);

      await login(2);
      const finalizado = await escalar<Movimiento>('SELECT public.hu003_confirmar_recepcion($1,$2) r', [unidadGerente, movimientoGerente]);
      assert.equal(finalizado.estado, 'Finalizado');
      assert.equal(finalizado.autorRecepcion?.nombre, 'Administradora QA');
      assert.match(finalizado.fechaRecepcion ?? '', /^\d{4}-\d{2}-\d{2}$/);
      assert.match(finalizado.horaRecepcion ?? '', /^\d{2}:\d{2}:\d{2}/);
      assert.equal(await escalarAdmin<string>('SELECT codubi::text r FROM unidad WHERE coduni=$1', [unidadGerente]), loc.fivesa);
      const despues = await escalarAdmin<Operativo>(`SELECT jsonb_build_object(
        'estcomuni',estcomuni,'codepr',codepr,'codtte',codtte,'codpro',codpro,'codubi',codubi
      ) r FROM unidad WHERE coduni=$1`, [unidadGerente]);
      assert.equal(despues.estcomuni, antes.estcomuni);
      assert.equal(despues.codepr, antes.codepr); assert.equal(despues.codtte, antes.codtte);
      assert.equal(despues.codpro, antes.codpro);
      assert.equal(await escalarAdmin<number>('SELECT count(*)::int r FROM separacion WHERE coduni=$1', [unidadGerente]), separacionesAntes);
      assert.equal(await escalarAdmin<number>('SELECT count(*)::int r FROM venta WHERE coduni=$1', [unidadGerente]), ventasAntes);
      await assert.rejects(escalar('SELECT public.hu003_confirmar_recepcion($1,$2) r', [unidadGerente, movimientoGerente]), error('PT425'));
    });

    await t.test('recibir movimiento de otra unidad devuelve 404; cambiar la unidad durante tránsito da conflicto', async () => {
      await assert.rejects(escalar('SELECT public.hu003_confirmar_recepcion($1,$2) r', [unidadDesfasada, movimientoGerente]), error('PT404'));
      const enCurso = await escalar<Movimiento>('SELECT public.hu003_iniciar_movimiento($1,$2,$3,NULL) r',
        [unidadDesfasada, loc.ancon, loc.fivesa]);
      await administrativo(() => db.exec(`UPDATE unidad SET codubi=${Number(loc.comas)} WHERE coduni=${Number(unidadDesfasada)}`));
      await assert.rejects(escalar('SELECT public.hu003_confirmar_recepcion($1,$2) r', [unidadDesfasada, enCurso.codmub]), error('PT409'));
      const pendiente = await escalarAdmin<Movimiento>('SELECT public.hu003_proyeccion_movimiento($1) r', [enCurso.codmub]);
      assert.equal(pendiente.estado, 'En transito');
      assert.equal(pendiente.fechaRecepcion, null); assert.equal(pendiente.autorRecepcion, null);
    });

    await t.test('consulta expone ubicación confirmada, movimiento activo e historial ordenado tras finalizar', async () => {
      const data = await escalar<EstadoUnidad>('SELECT public.hu003_consultar_movimientos($1) r', [unidadGerente]);
      assert.equal(data.ubicacionConfirmada?.codubi, loc.fivesa);
      assert.equal(data.movimientoActivo, null);
      assert.equal(data.movimientos.length, 1);
      assert.equal(data.movimientos[0].estado, 'Finalizado');
      assert.equal(data.movimientos[0].autorRecepcion?.nombre, 'Administradora QA');
      assert.ok(data.movimientos[0].fechaRecepcion);
      const activa = await escalar<EstadoUnidad>('SELECT public.hu003_consultar_movimientos($1) r', [unidadAdmin]);
      assert.equal(activa.ubicacionConfirmada?.codubi, loc.ancon);
      assert.equal(activa.movimientoActivo?.estado, 'En transito');
      assert.equal(activa.movimientoActivo?.destino.codubi, loc.comas);
      assert.equal(activa.movimientos[0].fechaRecepcion, null);
    });

    await t.test('Vendedor consulta; unidad inexistente se traduce a PT404', async () => {
      await login(3);
      const data = await escalar<EstadoUnidad>('SELECT public.hu003_consultar_movimientos($1) r', [unidadAdmin]);
      assert.equal(data.coduni, unidadAdmin);
      await assert.rejects(escalar('SELECT public.hu003_consultar_movimientos($1) r', ['9223372036854775000']), error('PT404'));
      await login(1);
    });

    await t.test('clientes authenticated/anon no conservan SELECT ni escritura directa en movimientos', async () => {
      assert.equal(await escalar<boolean>("SELECT has_table_privilege('authenticated','public.movimientoubicacion','INSERT') r"), false);
      assert.equal(await escalar<boolean>("SELECT has_table_privilege('authenticated','public.movimientoubicacion','SELECT') r"), false);
      assert.equal(await escalar<boolean>("SELECT has_table_privilege('anon','public.movimientoubicacion','INSERT') r"), false);
      assert.equal(await escalar<boolean>("SELECT has_table_privilege('anon','public.movimientoubicacion','SELECT') r"), false);
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`);
      await assert.rejects(db.exec(`INSERT INTO movimientoubicacion(coduni,codubiori,codubides,codusu)
        VALUES (${Number(unidadOperativa)},${Number(loc.ancon)},${Number(loc.fivesa)},1)`), error('42501'));
      await assert.rejects(db.exec('SELECT * FROM movimientoubicacion'), error('42501'));
      await db.exec('RESET ROLE; SET ROLE anon');
      await assert.rejects(db.exec('SELECT * FROM movimientoubicacion'), error('42501'));
      await db.exec('RESET ROLE');
    });
  } finally { await db.close(); }
});

test('HU-003 PostgreSQL: migración aborta sin borrar filas si hay movimientos activos duplicados', async () => {
  const db = new PGlite();
  try {
    await preparar(db, false);
    await db.exec(`INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',1);
      INSERT INTO unidad(codcom,codmod,codubi,nummotuni,chauni,coluni)
        SELECT 1,1,codubi,'M-DUP','C-DUP','Azul' FROM ubicacion WHERE nomubi='Crossland Ancón';
      INSERT INTO movimientoubicacion(coduni,codubiori,codubides,codusu,estmub)
        SELECT 1,c.codubi,f.codubi,1,'En transito' FROM ubicacion c,ubicacion f WHERE c.nomubi='Crossland Ancón' AND f.nomubi='FIVESA';
      INSERT INTO movimientoubicacion(coduni,codubiori,codubides,codusu,estmub)
        SELECT 1,c.codubi,m.codubi,1,'Pendiente' FROM ubicacion c,ubicacion m WHERE c.nomubi='Crossland Ancón' AND m.nomubi='Comas';`);
    await assert.rejects(db.exec(migracionHu003), (e: unknown) =>
      (e as ErrorSQL).message?.includes('más de un movimiento activo') === true);
    await db.exec('ROLLBACK');
    const total = (await db.query<{ total: number }>('SELECT count(*)::int total FROM movimientoubicacion')).rows[0].total;
    assert.equal(total, 2);
    assert.equal(Number((await db.query<{ count: string }>("SELECT count(*) FROM information_schema.columns WHERE table_name='movimientoubicacion' AND column_name='codusurec'")).rows[0].count), 0);
  } finally { await db.close(); }
});
