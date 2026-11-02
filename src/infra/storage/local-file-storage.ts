import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileStorage } from '../../domain/imports/ports.js';
import { env } from '../../config/env.js';

export class LocalFileStorage implements FileStorage {
  async saveTemp(content: Buffer, fileName: string): Promise<{ path: string; hash: string }> {
    const hash = createHash('sha256').update(content).digest('hex');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'import.csv';
    const path = join(env().IMPORT_STORAGE_DIR, `${hash}-${safeName}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return { path, hash };
  }

  async read(path: string): Promise<Buffer> {
    return readFile(path);
  }

  async delete(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // El archivo pudo haberse eliminado antes.
    }
  }
}
