// Trusted, bundled metadata only. Never import code from client-supplied manifests.
export const catalog = Object.freeze([
  { id: 'pos', name: 'POS', icon: '▣', color: 'blue', description: 'Modul kasir — kontrak bisnis belum diimplementasikan.' },
  { id: 'inventory', name: 'Inventory', icon: '▤', color: 'green', description: 'Modul persediaan — kontrak bisnis belum diimplementasikan.' },
  { id: 'crm', name: 'CRM', icon: '♧', color: 'purple', description: 'Modul pelanggan — kontrak bisnis belum diimplementasikan.' },
  { id: 'invoice', name: 'Invoice', icon: '▥', color: 'orange', description: 'Modul faktur — kontrak bisnis belum diimplementasikan.' }
]);
export const systemApps = [
  { id: 'users', name: 'Pengguna', icon: '♙', color: 'pink', permission: 'users.manage' },
  { id: 'apps', name: 'Aplikasi', icon: '◇', color: 'slate', permission: 'apps.manage' },
  { id: 'settings', name: 'Pengaturan', icon: '⚙', color: 'slate', permission: 'settings.manage' },
  { id: 'menus', name: 'Kelola Menu', icon: '≡', color: 'blue', permission: 'menus.manage' }
];
