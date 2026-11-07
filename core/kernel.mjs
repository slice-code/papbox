import { EventEmitter } from 'node:events';
export class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requirePermission(context, permission) {
  if (!context?.tenant || !context?.user) throw new Fault(401, 'Silakan masuk');
  if (!context.permissions?.includes(permission)) throw new Fault(403, 'Akses ditolak');
}
export class Kernel {
  events = new EventEmitter();
  services = new Map();
  register(name, permission, handler) {
    if (this.services.has(name)) throw new Error('Duplicate service');
    this.services.set(name, { permission, handler });
  }
  async invoke(name, context, input = {}) {
    const service = this.services.get(name);
    if (!service) throw new Fault(404, 'Layanan tidak ditemukan');
    requirePermission(context, service.permission);
    const result = await service.handler(context, input);
    this.events.emit('service:completed', { name, tenant: context.tenant, user: context.user });
    return result;
  }
}
