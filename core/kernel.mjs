import { validateModule,validateInput } from './contracts.mjs';
import { EventEmitter } from 'node:events';
export class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requirePermission(context, permission) {
  if (!context?.tenant || !context?.user) throw new Fault(401, 'Silakan masuk');
  if (!context.permissions?.includes(permission)) throw new Fault(403, 'Akses ditolak');
}
export class Kernel {
  events = new EventEmitter();
  services = new Map();
  modules = new Map();
  routes = new Map();
  install(contract, handlers) {
    const module=validateModule(contract);
    if(this.modules.has(module.id))throw new Fault(409,'Modul sudah terdaftar');
    for(const dependency of module.dependencies)if(this.modules.get(dependency.id)?.version!==dependency.version)throw new Fault(409,'Dependensi atau versi tidak terpenuhi');
    for(const service of module.services)if(this.services.has(service.name) || typeof handlers[service.name]!=='function')throw new Fault(409,'Layanan bentrok atau handler tidak tersedia');
    for(const route of module.routes)if(this.routes.has(route.method+' '+route.path))throw new Fault(409,'Rute sudah terdaftar');
    // Publish only after all declarations have been validated.
    for(const descriptor of module.services)this.services.set(descriptor.name,{...descriptor,handler:handlers[descriptor.name],module:module.id});
    for(const route of module.routes)this.routes.set(route.method+' '+route.path,route.service);
    this.modules.set(module.id,module);
  }
  describe() { return structuredClone([...this.modules.values()]); }
  register(name, permission, handler) {
    if (this.services.has(name)) throw new Error('Duplicate service');
    this.services.set(name, { permission, handler });
  }
  async invoke(name, context, input = {}) {
    const service = this.services.get(name);
    if (!service) throw new Fault(404, 'Layanan tidak ditemukan');
    requirePermission(context, service.permission);
    if(service.input)validateInput(input,service.input);
    if(service.confirmation && input.approved!==true)throw new Fault(400,'Konfirmasi eksplisit diperlukan');
    const result = await service.handler(context, input);
    this.events.emit('service:completed', { name, tenant: context.tenant, user: context.user });
    return result;
  }
}
