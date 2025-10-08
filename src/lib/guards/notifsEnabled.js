// backend: src/lib/guards/notifsEnabled.js
import notifsEnabled from "@/config/notifs";

export default function guardNotifsEnabled(req, res) {
  if (!notifsEnabled()) {
    res.status(503).json({ ok: false, reason: 'NOTIFS_DISABLED' });
    return false;
  }
  return true;
}
