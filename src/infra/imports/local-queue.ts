import type { ImportWorkerQueue } from '../../domain/imports/ports.js';

type Listener = () => void;

export class LocalImportQueue implements ImportWorkerQueue {
  private readonly listeners = new Set<Listener>();

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
