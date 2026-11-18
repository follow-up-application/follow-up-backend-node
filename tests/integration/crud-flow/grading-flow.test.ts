import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../../src/infra/db/client.js';
import { login, SEED } from '../../helpers/http.js';
import {
  authed,
  buildAcademicChain,
  expectStatus,
  setupCrudSuite,
  teardownCrudSuite,
  write,
  type AcademicChain,
} from './helpers.js';

let app: Express;
let adminToken: string;
let docenteToken: string;
let chain: AcademicChain;
let calificacionId: string;

beforeAll(async () => {
  ({ app, adminToken } = await setupCrudSuite());
  docenteToken = await login(app, 'docente', '10.72.0.2');
  chain = await buildAcademicChain(app, adminToken);

  const created = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
    instancia_id: chain.instancia.id,
    alumno_id: chain.alumno.id,
    valor: '8.50',
  });
  expectStatus(created, 201);
  calificacionId = String(created.body.id);
});

afterAll(async () => {
  await teardownCrudSuite();
});

describe('flujo HTTP de calificaciones, anulación, cierre y rectificación', () => {
  it('da de alta, anula, cierra el período y rectifica una calificación', async () => {
    const found = await authed(app, adminToken, 'get', `/api/v1/calificaciones/${calificacionId}`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({
      id: calificacionId,
      instancia_id: chain.instancia.id,
      alumno_id: chain.alumno.id,
      valor: '8.50',
      estado: 'activa',
      version: 1,
    });

    const listado = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/calificaciones?materia_id=${chain.materia.id}&periodo_id=${chain.periodo.id}&alumno_id=${chain.alumno.id}&limit=500&offset=0`,
    );
    expect(listado.status).toBe(200);
    expect(listado.body.data.map((item: { id: string }) => item.id)).toContain(calificacionId);

    const anulada = await write(
      app,
      adminToken,
      'post',
      `/api/v1/calificaciones/${calificacionId}/anular`,
      { motivo: 'Carga por error' },
    );
    expectStatus(anulada, 200);
    expect(anulada.body).toMatchObject({
      id: calificacionId,
      valor: '8.50',
      estado: 'anulada',
    });
    expect(anulada.body.version).toBe(2);

    const cerrado = await write(
      app,
      adminToken,
      'post',
      `/api/v1/periodos/${chain.periodo.id}/cerrar`,
      {},
    );
    expectStatus(cerrado, 200);
    expect(cerrado.body.cierre).toMatchObject({ periodo_id: chain.periodo.id });
    expect(cerrado.body.cierre.total_condiciones).toBeGreaterThan(0);
    expect(
      cerrado.body.condiciones.some(
        (condicion: { alumno_id: string; materia_id: number }) =>
          condicion.alumno_id === chain.alumno.id && condicion.materia_id === chain.materia.id,
      ),
    ).toBe(true);

    const periodo = await authed(app, adminToken, 'get', `/api/v1/periodos/${chain.periodo.id}`);
    expect(periodo.status).toBe(200);
    expect(periodo.body.estado).toBe('cerrado');

    const condiciones = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/periodos/${chain.periodo.id}/condiciones?materia_id=${chain.materia.id}&limit=500&offset=0`,
    );
    expect(condiciones.status).toBe(200);
    expect(
      condiciones.body.data.some(
        (item: { alumno_id: string; materia_id: number }) =>
          item.alumno_id === chain.alumno.id && item.materia_id === chain.materia.id,
      ),
    ).toBe(true);

    const condicionAlumno = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/alumnos/${chain.alumno.id}/condicion?periodo_id=${chain.periodo.id}`,
    );
    expect(condicionAlumno.status).toBe(200);
    expect(
      condicionAlumno.body.some(
        (item: { materia_id: number }) => item.materia_id === chain.materia.id,
      ),
    ).toBe(true);

    const rectificada = await write(
      app,
      adminToken,
      'post',
      `/api/v1/calificaciones/${calificacionId}/rectificar`,
      { valor: '9.50', motivo: 'Revisión de corrección' },
    );
    expectStatus(rectificada, 200);
    expect(rectificada.body).toMatchObject({
      id: calificacionId,
      valor: '9.50',
      estado: 'rectificada',
    });
    expect(rectificada.body.version).toBe(3);

    const persistida = await query<{
      estado: string;
      valor: string;
      rectificada_por: string | null;
      motivo_rectificacion: string | null;
    }>(
      `SELECT estado, valor::text AS valor, rectificada_por, motivo_rectificacion
         FROM calificaciones WHERE id = $1`,
      [calificacionId],
    );
    expect(persistida.rows[0]).toMatchObject({
      estado: 'rectificada',
      valor: '9.50',
      rectificada_por: SEED.adminId,
      motivo_rectificacion: 'Revisión de corrección',
    });

    const historial = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/calificaciones/${calificacionId}/historial`,
    );
    expect(historial.status).toBe(200);
    const acciones = historial.body.map((entry: { accion: string }) => entry.accion);
    expect(acciones).toContain('crear');
    expect(acciones).toContain('actualizar');
    expect(acciones).toContain('rectificar');

    const auditoriaPeriodo = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/auditoria?entidad=periodos&entidad_id=${chain.periodo.id}&limit=500&offset=0`,
    );
    expect(auditoriaPeriodo.status).toBe(200);
    expect(auditoriaPeriodo.body.data.map((entry: { accion: string }) => entry.accion)).toContain(
      'cerrar',
    );
  });

  it('rechaza accesos y operaciones inválidas en el flujo de calificaciones', async () => {
    const sinToken = await request(app).get(
      `/api/v1/calificaciones?materia_id=${chain.materia.id}&limit=500&offset=0`,
    );
    expect(sinToken.status).toBe(401);
    expect(sinToken.body.error.code).toBe('UNAUTHENTICATED');

    const valorInvalido = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
      instancia_id: chain.instancia.id,
      alumno_id: chain.alumno.id,
      valor: '11.00',
    });
    expect(valorInvalido.status).toBe(422);
    expect(valorInvalido.body.error.code).toBe('VALIDATION_ERROR');

    const duplicada = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
      instancia_id: chain.instancia.id,
      alumno_id: chain.alumno.id,
      valor: '7.00',
    });
    expect(duplicada.status).toBe(409);
    expect(duplicada.body.error.code).toBe('CONFLICT');

    const motivoVacio = await write(
      app,
      adminToken,
      'post',
      `/api/v1/calificaciones/${calificacionId}/anular`,
      { motivo: '' },
    );
    expect(motivoVacio.status).toBe(422);
    expect(motivoVacio.body.error.code).toBe('VALIDATION_ERROR');

    const rectificarDocente = await write(
      app,
      docenteToken,
      'post',
      `/api/v1/calificaciones/${calificacionId}/rectificar`,
      { valor: '9.00', motivo: 'Intento sin permisos' },
    );
    expect(rectificarDocente.status).toBe(403);
    expect(rectificarDocente.body.error.code).toBe('FORBIDDEN');

    const otroChain = await buildAcademicChain(app, adminToken);
    const otra = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
      instancia_id: otroChain.instancia.id,
      alumno_id: otroChain.alumno.id,
      valor: '6.00',
    });
    expectStatus(otra, 201);

    const rectificacionPrematura = await write(
      app,
      adminToken,
      'post',
      `/api/v1/calificaciones/${otra.body.id}/rectificar`,
      { valor: '7.00', motivo: 'Antes del cierre' },
    );
    expect(rectificacionPrematura.status).toBe(409);
    expect(rectificacionPrematura.body.error.code).toBe('CONFLICT');
  });
});
