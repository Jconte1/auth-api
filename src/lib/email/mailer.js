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

// ---- Store numbers (shared across all emails) ----
const STORE_NUMBERS = [
  { name: 'Salt Lake City', phone: '1-801-466-0990' },
  { name: 'Provo',         phone: '1-801-932-0027' },
  { name: 'Ketchum',       phone: '1-208-576-3643' },
  { name: 'Boise',         phone: '1-208-258-2479' },
  { name: 'Jackson',       phone: '1-307-200-4603' },
];

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

// Build link to the customer’s order summary page
function orderUrl(orderNbr) {
  const base = (FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/jobs/upcoming/${encodeURIComponent(orderNbr)}`;
}

function noReplyHTML() {
  return `
    <p style="margin:16px 0 0 0; color:#555;">
      <em>This email was sent from a notification-only address. Please don’t reply; this mailbox isn’t monitored.</em>
    </p>
  `;
}

function noReplyPlain() {
  return 'This email was sent from a notification-only address. Please do not reply; this mailbox isn’t monitored.';
}

// ---- Shared visual primitives ----
function buttonHTML(href, label) {
  return `
    <a href="${href}" style="
      display:inline-block;
      padding:10px 16px;
      background:#111;
      color:#fff !important;
      text-decoration:none;
      border-radius:6px;
      font-weight:600;
    ">${label}</a>
  `;
}

function disclaimerHTML() {
  const list = STORE_NUMBERS
    .map(s => `<li><strong>${s.name}</strong> — <a href="tel:${s.phone.replace(/\s+/g,'')}">${s.phone}</a></li>`)
    .join('');
  return `
    <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>
    <p style="margin:0 0 6px 0;"><em>If anything looks incorrect or needs to change, please contact your salesperson or call the showroom associated with your order.</em></p>
    <ul style="margin:8px 0 0 18px;padding:0;line-height:1.6">${list}</ul>
  `;
}

function disclaimerPlain() {
  const lines = [
    '— — —',
    'If anything looks incorrect or needs to change, please contact your salesperson or call the showroom associated with your order:',
    ...STORE_NUMBERS.map(s => `  • ${s.name}: ${s.phone}`),
  ];
  return lines.join('\n');
}

// ---- T42 (Action required) ----
export async function sendT42Email({ to, orderNbr, customerName, deliveryDate }) {
  if (!to) throw new Error('Missing recipient email');
  const url = orderUrl(orderNbr);

  const subject = `${APP_NAME} — Action required: please confirm your upcoming delivery`;
  const deliveryLine = deliveryDate ? `Delivery Date: ${new Date(deliveryDate).toLocaleDateString()}` : null;

  const plain = [
    `Hello${customerName ? ` ${customerName}` : ''},`,
    ``,
    `Action required: please confirm your ${APP_NAME} delivery (about six weeks out).`,
    deliveryLine,
    ``,
    `Confirm here: ${url}`,
    ``,
    `Order #: ${orderNbr}`,
    ``,
    noReplyPlain(),
    ``,
    disclaimerPlain(),
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.55;color:#111">
      <p>Hello${customerName ? ` ${customerName}` : ''},</p>
      <p style="margin:0 0 8px 0"><strong>Action required</strong>: please confirm your ${APP_NAME} delivery (about six weeks out).</p>
      <p style="margin:0 0 12px 0">
        ${deliveryLine ? `${deliveryLine}<br/>` : ''}
        Order # <strong>${orderNbr}</strong>
      </p>
      <p style="margin:16px 0">${buttonHTML(url, 'Confirm delivery')}</p>
      ${noReplyHTML()}
      ${disclaimerHTML()}
    </div>
  `;

  const info = await transporter.sendMail({ from: { name: APP_NAME, address: AUTO_EMAIL }, to, subject, text: plain, html });
  return { messageId: info?.messageId || null };
}


// ---- T14 (FYI / no action required) ----
export async function sendT14Email({ to, orderNbr, customerName, deliveryDate }) {
  if (!to) throw new Error('Missing recipient email');
  const url = orderUrl(orderNbr);

  const subject = `${APP_NAME} — Upcoming delivery (about two weeks)`;
  const deliveryLine = deliveryDate ? `Delivery Date: ${new Date(deliveryDate).toLocaleDateString()}` : null;

  const plain = [
    `Hello${customerName ? ` ${customerName}` : ''},`,
    ``,
    `Heads up: your ${APP_NAME} delivery is scheduled in about two weeks.`,
    deliveryLine,
    ``,
    `View your order summary: ${url}`,
    ``,
    `Order #: ${orderNbr}`,
    ``,
    noReplyPlain(),
    ``,
    disclaimerPlain(),
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.55;color:#111">
      <p>Hello${customerName ? ` ${customerName}` : ''},</p>
      <p>Your <strong>${APP_NAME}</strong> delivery is scheduled in about two weeks.</p>
      <p style="margin:0 0 12px 0">
        ${deliveryLine ? `${deliveryLine}<br/>` : ''}
        Order # <strong>${orderNbr}</strong>
      </p>
      <p style="margin:16px 0">${buttonHTML(url, 'View order summary')}</p>
      ${noReplyHTML()}
      ${disclaimerHTML()}
    </div>
  `;

  const info = await transporter.sendMail({ from: { name: APP_NAME, address: AUTO_EMAIL }, to, subject, text: plain, html });
  return { messageId: info?.messageId || null };
}


// ---- T3 (FYI / no action required) ----
export async function sendT3Email({ to, orderNbr, customerName, deliveryDate }) {
  if (!to) throw new Error('Missing recipient email');
  const url = orderUrl(orderNbr);

  const subject = `${APP_NAME} — Delivery reminder (coming days)`;
  const deliveryLine = deliveryDate ? `Delivery Date: ${new Date(deliveryDate).toLocaleDateString()}` : null;

  const plain = [
    `Hello${customerName ? ` ${customerName}` : ''},`,
    ``,
    `Just a reminder: your ${APP_NAME} delivery is scheduled in the coming days.`,
    deliveryLine,
    ``,
    `You'll also receive a text message shortly to confirm delivery and jobsite details.`,
    ``,
    `View your order summary: ${url}`,
    ``,
    `Order #: ${orderNbr}`,
    ``,
    noReplyPlain(),
    ``,
    disclaimerPlain(),
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.55;color:#111">
      <p>Hello${customerName ? ` ${customerName}` : ''},</p>
      <p>Your <strong>${APP_NAME}</strong> delivery is scheduled in the coming days.</p>
      <p style="margin:0 0 12px 0">
        ${deliveryLine ? `${deliveryLine}<br/>` : ''}
        Order # <strong>${orderNbr}</strong>
      </p>
      <p style="margin:0 0 12px 0">
        You'll also receive a text message shortly to confirm delivery and jobsite details.
      </p>
      <p style="margin:16px 0">${buttonHTML(url, 'View order summary')}</p>
      ${noReplyHTML()}
      ${disclaimerHTML()}
    </div>
  `;

  const info = await transporter.sendMail({ from: { name: APP_NAME, address: AUTO_EMAIL }, to, subject, text: plain, html });
  return { messageId: info?.messageId || null };
}

