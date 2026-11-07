import {createCipheriv,createDecipheriv,createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {Fault} from '../core/kernel.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31];}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
export function fromBase32(input){let bits=0,value=0,out=[];for(const char of input){const index=alphabet.indexOf(char);if(index<0)throw Error('Invalid base32');value=(value<<5)|index;bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255);}}return Buffer.from(out);}
export function totp(secret,counter){const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(counter));const hash=createHmac('sha1',fromBase32(secret)).update(bytes).digest(),offset=hash[19]&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
export class Mfa {
 constructor(key,{now=()=>Date.now()}={}){if(key && !/^[a-f0-9]{64}$/i.test(key))throw Error('PAPBOX_ENCRYPTION_KEY must be 32-byte hex');this.key=key?Buffer.from(key,'hex'):null;this.now=now;}
 requireKey(){if(!this.key)throw new Fault(503,'MFA belum dikonfigurasi operator');}
 encrypt(secret,aad){this.requireKey();const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(aad));return {iv:iv.toString('hex'),data:Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]).toString('hex'),tag:cipher.getAuthTag().toString('hex')};}
 decrypt(value,aad){this.requireKey();try{const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'hex'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(value.tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(value.data,'hex')),cipher.final()]).toString('utf8');}catch{throw new Fault(503,'Konfigurasi kunci MFA tidak cocok; hubungi operator');}}
 begin(user,tenant){
  this.requireKey();if(user.security?.mfa)throw new Fault(409,'MFA sudah aktif');
  const secret=base32(randomBytes(20));user.security||={};user.security.pending={secret:this.encrypt(secret,tenant+':'+user.id),expires:this.now()+10*60000};
  return {secret,uri:'otpauth://totp/'+encodeURIComponent('PAPbox:'+tenant+':'+user.email)+'?'+new URLSearchParams({secret,issuer:'PAPbox',algorithm:'SHA1',digits:'6',period:'30'}),expires:new Date(user.security.pending.expires).toISOString()};
 }
 counter(secret,code,last=-1){if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;const current=Math.floor(this.now()/30000);for(const counter of [current,current-1,current+1])if(counter>=0&&counter>last&&timingSafeEqual(Buffer.from(totp(secret,counter)),Buffer.from(code)))return counter;return null;}
 confirm(user,tenant,code){
  const pending=user.security?.pending;if(!pending||pending.expires<=this.now())throw new Fault(400,'Pendaftaran MFA tidak ada atau kedaluwarsa');
  const secret=this.decrypt(pending.secret,tenant+':'+user.id),counter=this.counter(secret,code);if(counter===null)throw new Fault(400,'Kode MFA tidak valid');
  const recoveryCodes=Array.from({length:10},()=>randomBytes(16).toString('hex'));
  user.security.mfa={secret:pending.secret,lastCounter:counter,recoveryHashes:recoveryCodes.map(digest)};delete user.security.pending;
  return {recoveryCodes};
 }
 verify(user,tenant,code){
  const config=user.security?.mfa;if(!config)return true;
  if(typeof code!=='string')return false;
  if(/^[a-f0-9]{32}$/.test(code)){const hash=digest(code),index=config.recoveryHashes.indexOf(hash);if(index<0)return false;config.recoveryHashes.splice(index,1);return true;}
  const counter=this.counter(this.decrypt(config.secret,tenant+':'+user.id),code,config.lastCounter);if(counter===null)return false;config.lastCounter=counter;return true;
 }
}
