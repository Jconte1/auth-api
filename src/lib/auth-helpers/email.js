import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  AUTO_EMAIL,
  AUTO_EMAIL_PASSWORD,
  FRONTEND_URL,
  APP_NAME = 'MLD',
} = process.env;

// Singleton pattern for transporter in dev to prevent multiple instances
let transporter = global.transporter;

if (!transporter) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: false,
    auth: {
      user: AUTO_EMAIL,
      pass: AUTO_EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    global.transporter = transporter;
  }
}

/**
 * Send verification, password reset, or OTP email.
 * @param {Object} options
 * @param {string} options.to - Recipient's email
 * @param {string} options.name - Recipient's name
 * @param {string} options.token - Token or OTP code for the action
 * @param {string} options.type - 'verify' (default), 'reset', or 'otp'
 */
export default async function sendAuthEmail({ to, name, token, type = 'verify' }) {
  let link, subject, html, text;

  if (type === 'reset') {
    // Password reset via email link (not used for OTP flow)
    link = `${FRONTEND_URL}/auth/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
    subject = `Reset your ${APP_NAME} password`;
    html = `
      <div style="font-family:sans-serif">
        <h2>Password Reset Request for ${APP_NAME}</h2>
        <p>Hello ${name || 'there'},</p>
        <p>You requested a password reset. Click the button below to set a new password:</p>
        <p><a href="${link}" style="background:#0050b3;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Reset Password</a></p>
        <p>This link is valid for 1 hour. If you did not request this, you can safely ignore this email.</p>
        <p>— The ${APP_NAME} Team</p>
      </div>
    `;
    text = `Hello ${name || 'there'},\n\nYou requested a password reset for your ${APP_NAME} account.\nReset your password here: ${link}\n\nIf you did not request this, you can ignore this email.\n\n— The ${APP_NAME} Team`;

  } else if (type === 'otp') {
    // One-time code for password reset (shown in-app)
    subject = `Your ${APP_NAME} password reset code`;
    html = `
      <div style="font-family:sans-serif">
        <h2>${APP_NAME} Password Reset Code</h2>
        <p>Hello ${name || 'there'},</p>
        <p>Your one-time password (OTP) to reset your account is:</p>
        <div style="font-size:2rem;font-weight:bold;letter-spacing:6px;margin:22px 0 18px 0;">${token}</div>
        <p>This code is valid for 10 minutes. If you did not request this, you can ignore this email.</p>
        <p>— The ${APP_NAME} Team</p>
      </div>
    `;
    text = `Hello ${name || 'there'},\n\nYour OTP for resetting your ${APP_NAME} password is: ${token}\n\nThis code is valid for 10 minutes.\nIf you did not request this, you can ignore this email.\n\n— The ${APP_NAME} Team`;

  } else {
    // Account verification (default)
    link = `${FRONTEND_URL}/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
    subject = `Verify your ${APP_NAME} account`;
    html = `
      <div style="font-family:sans-serif">
        <h2>Welcome to ${APP_NAME}, ${name || 'there'}!</h2>
        <p>To verify your email address and activate your account, please click the button below:</p>
        <p><a href="${link}" style="background:#0050b3;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Verify Email</a></p>
        <p>If you did not create this account, you can ignore this email.</p>
        <p>— The ${APP_NAME} Team</p>
      </div>
    `;
    text = `Welcome to ${APP_NAME}, ${name || 'there'}!\n\nPlease verify your email by visiting the following link:\n${link}\n\nIf you did not create this account, you can ignore this email.\n\n— The ${APP_NAME} Team`;
  }

  const mailOptions = {
    from: `"${APP_NAME} Team" <${AUTO_EMAIL}>`,
    to,
    subject,
    html,
    text,
  };

  return transporter.sendMail(mailOptions);
}
