import {posApp} from './pos/manifest.mjs';
// Trusted, bundled metadata only. Never import code from client-supplied manifests.
export const catalog = Object.freeze([
  posApp,
  { id: 'inventory', name: 'Inventory', icon: '▤', color: 'green', description: 'Modul persediaan — kontrak bisnis belum diimplementasikan.' },
  { id: 'crm', name: 'CRM', icon: '♧', color: 'purple', description: 'Modul pelanggan — kontrak bisnis belum diimplementasikan.' },
  { id: 'invoice', name: 'Invoice', icon: '▥', color: 'orange', description: 'Modul faktur — kontrak bisnis belum diimplementasikan.' }
]);
export const systemApps = [
  {id:'approvals',name:'Persetujuan AI',icon:'✓',color:'green',permission:'approvals.read'},
  {id:'access',name:'Hak Akses',icon:'⌘',color:'purple',permission:'roles.read'},
  { id:'account',name:'Akun Saya',icon:'◎',color:'blue',permission:'launcher.read' },
  { id: 'users', name: 'Pengguna', icon: '♙', color: 'pink', permission: 'users.read' },
  { id: 'apps', name: 'Aplikasi', icon: '◇', color: 'slate', permission: 'apps.read' },
  { id: 'settings', name: 'Pengaturan', icon: '⚙', color: 'slate', permission: 'settings.read' },
  { id: 'menus', name: 'Kelola Menu', icon: '≡', color: 'blue', permission: 'menus.read' }
];
