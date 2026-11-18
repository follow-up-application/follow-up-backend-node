import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authed,
  buildAcademicChain,
  expectStatus,
  setupCrudSuite,
  teardownCrudSuite,
  write,
} from './helpers.js';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  ({ app, adminToken } = await setupCrudSuite());
});

afterAll(async () => {
  await teardownCrudSuite();
});

describe('CRUD de asistencia, calificaciones y auditoría', () => {
  it('registra, consulta, justifica y corrige una asistencia', async () => {
    const chain = await buildAcademicChain(app, adminToken);
    const created = await write(app, adminToken, 'post', '/api/v1/asistencias', {
      clase_id: chain.clase.id,
      alumno_id: chain.alumno.id,
      estado: 'ausente',
    });
    expectStatus(created, 201);
    const asistenciaId = String(created.body.id);
    expect(created.body.version).toBe(1);

    const byClase = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/asistencias?clase_id=${chain.clase.id}`,
    );
    expect(byClase.status).toBe(200);
    expect(byClase.body.clase.id).toBe(chain.clase.id);
    const registro = byClase.body.alumnos.find(
      (item: { alumno: { id: string } }) => item.alumno.id === chain.alumno.id,
    );
    expect(registro?.asistencia.id).toBe(asistenciaId);

    const byAlumno = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/asistencias?alumno_id=${chain.alumno.id}&periodo_id=${chain.periodo.id}`,
    );
    expect(byAlumno.status).toBe(200);
    expect(byAlumno.body.map((item: { id: string }) => item.id)).toContain(asistenciaId);

    const justified = await write(
      app,
      adminToken,
      'put',
      `/api/v1/asistencias/${asistenciaId}/justificacion`,
      { justificacion: 'Certificado médico' },
    );
    expectStatus(justified, 200);
    expect(justified.body.estado).toBe('justificada');
    expect(justified.body.justificacion).toBe('Certificado médico');

    const updated = await write(app, adminToken, 'put', `/api/v1/asistencias/${asistenciaId}`, {
      estado: 'presente',
      motivo: 'Corrección de registro',
      version: justified.body.version,
    });
    expectStatus(updated, 200);
    expect(updated.body.estado).toBe('presente');
  });

  it('crea, consulta y actualiza un período y una instancia de evaluación', async () => {
    const chain = await buildAcademicChain(app, adminToken);

    const periodo = await authed(app, adminToken, 'get', `/api/v1/periodos/${chain.periodo.id}`);
    expect(periodo.status).toBe(200);
    expect(periodo.body.estado).toBe('abierto');

    const periodos = await authed(
      app,
      adminToken,
      'get',
      '/api/v1/periodos?ciclo_lectivo_id=' +
        periodo.body.ciclo_lectivo_id +
        '&estado=abierto&limit=500&offset=0',
    );
    expect(periodos.status).toBe(200);
    expect(periodos.body.data.map((item: { id: string }) => item.id)).toContain(chain.periodo.id);

    const nombreActualizado = `Período actualizado ${randomUUID().slice(0, 8)}`;
    const periodoActualizado = await write(
      app,
      adminToken,
      'put',
      `/api/v1/periodos/${chain.periodo.id}`,
      { nombre: nombreActualizado, version: periodo.body.version },
    );
    expectStatus(periodoActualizado, 200);
    expect(periodoActualizado.body.nombre).toBe(nombreActualizado);

    const instancia = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/instancias-evaluacion/${chain.instancia.id}`,
    );
    expect(instancia.status).toBe(200);
    expect(instancia.body.periodo_id).toBe(chain.periodo.id);

    const instancias = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/instancias-evaluacion?materia_id=${chain.materia.id}&periodo_id=${chain.periodo.id}&limit=500&offset=0`,
    );
    expect(instancias.status).toBe(200);
    expect(instancias.body.data.map((item: { id: string }) => item.id)).toContain(
      chain.instancia.id,
    );

    const instanciaActualizada = await write(
      app,
      adminToken,
      'put',
      `/api/v1/instancias-evaluacion/${chain.instancia.id}`,
      { nombre: 'Instancia actualizada', version: instancia.body.version },
    );
    expectStatus(instanciaActualizada, 200);
    expect(instanciaActualizada.body.nombre).toBe('Instancia actualizada');
  });

  it('carga, corrige, anula y audita una calificación', async () => {
    const chain = await buildAcademicChain(app, adminToken);
    const created = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
      instancia_id: chain.instancia.id,
      alumno_id: chain.alumno.id,
      valor: '8.50',
    });
    expectStatus(created, 201);
    const calificacionId = String(created.body.id);
    expect(created.body.valor).toBe('8.50');
    expect(created.body.estado).toBe('activa');

    const found = await authed(app, adminToken, 'get', `/api/v1/calificaciones/${calificacionId}`);
    expect(found.status).toBe(200);
    expect(found.body.alumno_id).toBe(chain.alumno.id);

    const byFilters = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/calificaciones?materia_id=${chain.materia.id}&periodo_id=${chain.periodo.id}&limit=500&offset=0`,
    );
    expect(byFilters.status).toBe(200);
    expect(byFilters.body.data.map((item: { id: string }) => item.id)).toContain(calificacionId);

    const updated = await write(
      app,
      adminToken,
      'put',
      `/api/v1/calificaciones/${calificacionId}`,
      {
        valor: '9.00',
        motivo: 'Ajuste de nota',
        version: found.body.version,
      },
    );
    expectStatus(updated, 200);
    expect(updated.body.valor).toBe('9.00');

    const annulled = await write(
      app,
      adminToken,
      'post',
      `/api/v1/calificaciones/${calificacionId}/anular`,
      { motivo: 'Carga por error' },
    );
    expectStatus(annulled, 200);
    expect(annulled.body.estado).toBe('anulada');

    const history = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/calificaciones/${calificacionId}/historial`,
    );
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThanOrEqual(2);
    expect(
      history.body.every((entry: { entidad_id: string }) => entry.entidad_id === calificacionId),
    ).toBe(true);

    const audit = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/auditoria?entidad=calificaciones&entidad_id=${calificacionId}&limit=500&offset=0`,
    );
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((entry: { entidad_id: string }) => entry.entidad_id)).toContain(
      calificacionId,
    );
  });

  it('cierra un período, consulta condiciones y rectifica una calificación', async () => {
    const chain = await buildAcademicChain(app, adminToken);
    const calificacion = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
      instancia_id: chain.instancia.id,
      alumno_id: chain.alumno.id,
      valor: '7.50',
    });
    expectStatus(calificacion, 201);
    const calificacionId = String(calificacion.body.id);

    const closed = await write(
      app,
      adminToken,
      'post',
      `/api/v1/periodos/${chain.periodo.id}/cerrar`,
      {},
    );
    expectStatus(closed, 200);
    expect(closed.body.cierre.periodo_id).toBe(chain.periodo.id);
    expect(closed.body.condiciones.length).toBeGreaterThan(0);
    expect(
      closed.body.condiciones.some(
        (condicion: { alumno_id: string; materia_id: number }) =>
          condicion.alumno_id === chain.alumno.id && condicion.materia_id === chain.materia.id,
      ),
    ).toBe(true);

    const condiciones = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/periodos/${chain.periodo.id}/condiciones?materia_id=${chain.materia.id}&limit=500&offset=0`,
    );
    expect(condiciones.status).toBe(200);
    expect(
      condiciones.body.data.some(
        (item: { alumno_id: string }) => item.alumno_id === chain.alumno.id,
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
    expect(rectificada.body.estado).toBe('rectificada');
    expect(rectificada.body.valor).toBe('9.50');
  });
});
