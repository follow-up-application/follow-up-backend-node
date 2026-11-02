import { afterAll, describe, expect, it } from 'vitest';
import { buildContainer } from '../../src/composition.js';
import { AttendanceService } from '../../src/application/attendance-service.js';
import { closePool, pool } from '../../src/infra/db/client.js';
import type { Actor, UserId } from '../../src/domain/shared/types.js';

const ASISTENCIA_ID = '66666666-6666-4666-8666-666666666661';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

const container = buildContainer();
const service = new AttendanceService(container);
const actor: Actor = {
  id: ADMIN_ID as UserId,
  role: 'administrador',
  mustChangePassword: false,
  passwordChangeOnly: false,
};
const ctx = { actor, requestId: 'test-notification-hook', ip: null, userAgent: null };

afterAll(async () => {
  await pool.query(
    "DELETE FROM notificaciones WHERE tipo = 'ausencia_registrada' AND payload->>'asistencia_id' = $1",
    [ASISTENCIA_ID],
  );
  await closePool();
});

describe('hook de ausencias', () => {
  it('encola una notificación para el tutor al pasar a ausente', async () => {
    const before = await container.asistencias.findById(ASISTENCIA_ID);
    expect(before?.estado).toBe('presente');

    await service.update(
      actor,
      ASISTENCIA_ID,
      { estado: 'ausente', motivo: 'Prueba de notificación', version: before?.version },
      ctx,
    );

    const result = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM notificaciones n
       JOIN tutor_alumno ta ON ta.tutor_id = n.destinatario_id
       WHERE n.tipo = 'ausencia_registrada'
         AND n.payload->>'asistencia_id' = $1
         AND ta.alumno_id = $2
         AND ta.activa`,
      [ASISTENCIA_ID, before?.alumnoId],
    );
    expect(result.rows[0]?.total).toBe(1);

    const updated = await container.asistencias.findById(ASISTENCIA_ID);
    await service.update(
      actor,
      ASISTENCIA_ID,
      { estado: 'presente', motivo: 'Restauración de prueba', version: updated?.version },
      ctx,
    );
  });

  it('no encola una notificación si el estado no cambia', async () => {
    const before = await container.asistencias.findById(ASISTENCIA_ID);
    const countBefore = await pool.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM notificaciones WHERE tipo = 'ausencia_registrada'",
    );

    await service.update(
      actor,
      ASISTENCIA_ID,
      { estado: 'presente', motivo: 'Sin cambio', version: before?.version },
      ctx,
    );

    const countAfter = await pool.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM notificaciones WHERE tipo = 'ausencia_registrada'",
    );
    expect(countAfter.rows[0]?.total).toBe(countBefore.rows[0]?.total);
  });
});
