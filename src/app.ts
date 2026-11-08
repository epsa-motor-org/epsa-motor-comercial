import express from 'express';
import cors from 'cors';

import type { ErrorRequestHandler } from 'express';
import type { FabricaCliente } from './middleware/autenticacion';

import { crearRutasUbicacion } from './routes/ubicacion.routes';
import { crearRutasCompra } from './routes/compra.routes';
import { crearRutasModelo } from './routes/modelo.routes';
import type { FabricaClientePublico } from './types/modelo.types';
import { crearRutasUnidad } from './routes/unidad.routes';
import { crearRutasTecho } from './routes/techo.routes';
import { crearRutasLead } from './routes/lead.routes';
import { crearRutasSede } from './routes/sede.routes';
import { crearRutasMovimiento } from './routes/movimiento.routes';
import { crearRutasPreparacionUnidad } from './routes/preparacion.unidad.routes';
import { crearRutasInventario } from './routes/inventario.routes';
import { crearRutasIntegracionFacturas } from './routes/integracion.facturas.routes';
import { crearRutasComprasPendientes } from './routes/compras.pendientes.routes';
import { crearRutasSeparacion } from './routes/separacion.routes';
import { crearRutasSeparacionApoyo } from './routes/separacion.apoyo.routes';
import type { FabricaClienteIntegracion } from './middleware/integracion.hmac';

export function crearApp(fabrica?: FabricaCliente, fabricaPublica?: FabricaClientePublico, fabricaIntegracion?: FabricaClienteIntegracion) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/modelos', crearRutasModelo(fabricaPublica, fabrica));
  app.use('/api/sedes', crearRutasSede(fabricaPublica));
  app.use('/api/leads', crearRutasLead(fabrica));
  app.use('/api/inventario', crearRutasInventario(fabrica));
  app.use('/api/compras-pendientes', crearRutasComprasPendientes(fabrica));
  app.use('/api/separaciones', crearRutasSeparacionApoyo(fabrica));
  app.use('/api/integraciones/facturas', crearRutasIntegracionFacturas(fabricaIntegracion));

  app.get('/', (_req, res) => {
    res.json({
      message: 'API EPSA Motor funcionando'
    });
  });

  app.use(
    '/api/ubicaciones',
    crearRutasUbicacion(fabrica)
  );

  app.use(
    '/api/compras',
    crearRutasUnidad(fabrica)
  );

  app.use(
    '/api/unidades',
    crearRutasTecho(fabrica)
  );

  app.use(
    '/api/unidades',
    crearRutasMovimiento(fabrica)
  );

  app.use(
    '/api/unidades',
    crearRutasPreparacionUnidad(fabrica)
  );

  app.use(
    '/api/unidades',
    crearRutasSeparacion(fabrica)
  );

  app.use(
    '/api/compras',
    crearRutasCompra(fabrica)
  );

  const errores: ErrorRequestHandler = (
    err,
    _req,
    res,
    _next
  ) => {
    let status = 500;
    let message = 'Error interno';

    if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'JSON no válido';
    } else if (err.type === 'entity.too.large') {
      status = 413;
      message = 'Solicitud demasiado grande';
    }

    res.status(status).json({
      ok: false,
      message
    });
  };

  app.use(errores);

  return app;
}
