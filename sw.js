// sw.js — Service Worker de Órbita
// Recibe las notificaciones Web Push y las muestra al usuario.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Órbita', body: event.data.text() }; }

  const title   = data.title || 'Órbita';
  const options = {
    body:    data.body  || '',
    icon:    data.icon  || '/favicon.ico',
    badge:   data.badge || '/favicon.ico',
    vibrate: [200, 100, 200],
    data:    data.data  || {},
    actions: [{ action: 'ver', title: 'Ver pedido' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const pedidoId = event.notification.data?.pedido_id;
  const url      = pedidoId
    ? `/seguimiento.html?id=${pedidoId}`
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña abierta, enfocarla
      for (const client of clientList) {
        if (client.url.includes('seguimiento') && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una nueva
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
