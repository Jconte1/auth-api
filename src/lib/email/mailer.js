// src/lib/email/mailer.js
import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  AUTO_EMAIL,
  AUTO_EMAIL_PASSWORD,
  FRONTEND_URL,
  APP_NAME = 'MLD',
} = process.env;

// Singleton transporter (dev-safe)
let transporter = global.__mld_tx__;
if (!transporter) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: false,
    auth: { user: AUTO_EMAIL, pass: AUTO_EMAIL_PASSWORD },
    tls: { rejectUnauthorized: false },
  });
  if (process.env.NODE_ENV !== 'production') global.__mld_tx__ = transporter;
}

/**
 * Build the customer link to your order page.
 * Example target (per your earlier example): /jobs/upcoming/:orderNbr
 */
function orderUrl(orderNbr) {
  const base = (FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/jobs/upcoming/${encodeURIComponent(orderNbr)}`;
}

/**
 * Send T42 confirmation email.
 * Returns { messageId } on success.
 */
export async function sendT42Email({ to, orderNbr, customerName, deliveryDate }) {
  if (!to) throw new Error('Missing recipient email');
  const url = orderUrl(orderNbr);

  const subject = `${APP_NAME} — Please confirm your upcoming delivery`;
  const plain = [
    `Hello${customerName ? ` ${customerName}` : ''},`,
    ``,
    `Your ${APP_NAME} delivery is scheduled in about six weeks.`,
    `Please confirm your details here: ${url}`,
    ``,
    `Order #: ${orderNbr}`,
    deliveryDate ? `Delivery Date: ${new Date(deliveryDate).toLocaleDateString()}` : null,
    ``,
    `If anything needs to change, reply to this email or call your store.`,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111">
      <p>Hello${customerName ? ` ${customerName}` : ''},</p>
      <p>Your <strong>${APP_NAME}</strong> delivery is scheduled in about six weeks.</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">Confirm delivery</a></p>
      <p style="margin-top:12px">Order # <strong>${orderNbr}</strong><br/>
      ${deliveryDate ? `Delivery date: <strong>${new Date(deliveryDate).toLocaleDateString()}</strong><br/>` : ''}</p>
      <p>If anything needs to change, reply to this email or call your store.</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: { name: APP_NAME, address: AUTO_EMAIL },
    to,
    subject,
    text: plain,
    html,
  });

  return { messageId: info?.messageId || null };
}
