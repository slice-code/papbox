import {Fault} from '../../core/kernel.mjs';
const mailbox=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
export class GoogleMail {
 constructor({clientId,clientSecret,refreshToken,from,publicUrl,fetch:request=fetch}){
  if(!clientId||!clientSecret||!refreshToken||!mailbox.test(from||''))throw Error('Google mail configuration incomplete');
  const url=new URL(publicUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('PAPBOX_PUBLIC_URL must be an HTTPS origin');
  Object.assign(this,{clientId,clientSecret,refreshToken,from,publicUrl:url.origin,request});
 }
 async accessToken(){
  if(this.cached?.expires>Date.now()+60000)return this.cached.value;
  const response=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,client_secret:this.clientSecret,refresh_token:this.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Fault(502,'Google mail authentication unavailable');const data=await response.json();
  if(typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<1)throw new Fault(502,'Google mail token response invalid');
  this.cached={value:data.access_token,expires:Date.now()+Math.min(data.expires_in,3600)*1000};return data.access_token;
 }
 async sendReset({to,token}){
  if(!mailbox.test(to))throw new Fault(400,'Email recipient invalid');
  const link=this.publicUrl+'/#reset='+encodeURIComponent(token);
  const message=`From: ${this.from}\r\nTo: ${to}\r\nSubject: PAPbox password recovery\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nGunakan tautan ini untuk mengganti kata sandi PAPbox. Berlaku 15 menit dan hanya sekali pakai.\r\n${link}\r\n\r\nJika Anda tidak meminta pemulihan, abaikan pesan ini. MFA yang sudah aktif tetap diperlukan.\r\n`;
  const response=await this.request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+await this.accessToken(),'Content-Type':'application/json'},body:JSON.stringify({raw:Buffer.from(message).toString('base64url')}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Fault(502,'Google mail delivery unavailable');
 }
}
export function configuredMail(env=process.env){
 if(env.PAPBOX_EMAIL_ENABLED!=='true')return null;
 return new GoogleMail({clientId:env.GOOGLE_MAIL_CLIENT_ID,clientSecret:env.GOOGLE_MAIL_CLIENT_SECRET,refreshToken:env.GOOGLE_MAIL_REFRESH_TOKEN,from:env.GOOGLE_MAIL_FROM,publicUrl:env.PAPBOX_PUBLIC_URL});
}
