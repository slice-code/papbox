import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
export class Store {
  constructor(path) { this.path = path; this.queue = Promise.resolve(); }
  async read() { try { return JSON.parse(await readFile(this.path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return { tenants: {} }; throw error; } }
  transact(operation) {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = await operation(state);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(this.path + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(this.path + '.tmp', this.path);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
