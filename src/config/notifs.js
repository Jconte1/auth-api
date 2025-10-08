// backend: src/config/notifs.js
export default function notifsEnabled() {
  const v = (process.env.NOTIFS_ENABLED || 'false').toLowerCase();
  return v === 'true';
}


