import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { baselineRoles } from './access.mjs';
import { Fault } from '../core/kernel.mjs';
export const roles=baselineRoles;
export function text(value, max = 80) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Fault(400, 'Isian tidak valid'); return value.trim(); }
export function passwordHash(password) { if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Fault(400, 'Kata sandi harus 12–256 karakter'); const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
export function verify(password, hash) {
  if(typeof password!=='string' || password.length>256 || typeof hash!=='string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash))return false;
  const [salt,key]=hash.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'));
}
