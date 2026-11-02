import { parentPort, workerData } from 'node:worker_threads';
import {
  AlumnosCsvParseError,
  parseAlumnosCsv,
  type AlumnosCsvParserInput,
  type AlumnosCsvParsedBatchRow,
} from './alumnos-csv-parser.js';

type WorkerMessage =
  | { type: 'start'; totalRows: number }
  | { type: 'batch'; rows: AlumnosCsvParsedBatchRow[] }
  | { type: 'done'; totalRows: number; validRows: number; errorRows: number }
  | { type: 'limit'; totalRows: number }
  | { type: 'fatal'; message: string };

const input = workerData as AlumnosCsvParserInput;
const port = parentPort;

function send(message: WorkerMessage): void {
  port?.postMessage(message);
}

async function main(): Promise<void> {
  const result = await parseAlumnosCsv(input, {
    onStart: (totalRows) => send({ type: 'start', totalRows }),
    onBatch: (rows) => send({ type: 'batch', rows }),
  });
  send({ type: 'done', ...result });
}

main().catch((error: unknown) => {
  if (error instanceof AlumnosCsvParseError) {
    if (error.kind === 'limit') {
      send({ type: 'limit', totalRows: error.totalRows });
      return;
    }
    send({ type: 'fatal', message: error.message });
    return;
  }
  send({
    type: 'fatal',
    message: error instanceof Error ? error.message : 'Error inesperado al procesar el CSV.',
  });
});
