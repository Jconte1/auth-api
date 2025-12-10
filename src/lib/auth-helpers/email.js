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
 * Send verification, password reset, OTP, RFQ confirmation, or RFQ summary email.
 * @param {Object} options
 * @param {string} options.to - Recipient's email
 * @param {string} options.name - Recipient's name
 * @param {string} [options.token] - Token or OTP code for the action
 * @param {string} [options.type] - 'verify' (default), 'reset', 'otp', 'rfq-confirm', or 'rfq-summary'
 * @param {string|number} [options.quoteId] - Optional quote ID for RFQ summary
 * @param {Array} [options.cart] - Optional cart snapshot for RFQ summary
 * @param {Object} [options.shipping] - Optional shipping/contact info for RFQ summary
 *   { name, line1, line2, city, state, zip }
 */
export default async function sendAuthEmail({
  to,
  name,
  token,
  type = 'verify',
  quoteId,
  cart,
  shipping,
}) {
  let link, subject, html, text;

  if (type === 'reset') {
    // Password reset via email link (not used for OTP flow)
    link = `${FRONTEND_URL}/auth/reset-password?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(to)}`;
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

  } else if (type === 'rfq-summary') {
    // Outlet quote "thank you" / summary email (no magic link)
    const safeName = name || 'there';
    

    const items = Array.isArray(cart) ? cart : [];

    const formatMoney = (value) => {
      if (value == null || isNaN(value)) return 'TBD';
      return `$${Number(value).toFixed(2)}`;
    };

    let subtotal = 0;
    const lineItemsHtml = items.length
      ? items
        .map((item) => {
          // 🔧 IMPORTANT: prefer modelNumber now
          const sku =
            item.modelNumber ||
            item.sku ||
            item.acumaticaSku ||
            'Unknown Model';

          const description =
            item.description || item.name || 'Item description';
          const qty = item.quantity ?? 1;
          const price =
            item.price != null ? Number(item.price) : null;
          const lineTotal =
            price != null ? price * Number(qty || 1) : null;

          if (price != null) {
            subtotal += lineTotal;
          }

          const imageUrl =
            item.imageUrl || item.thumbnailUrl || item.image || '';

          return `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    <tr>
                      ${imageUrl
              ? `<td width="64" style="padding-right:10px;vertical-align:top;">
                               <img src="${imageUrl}" alt="${description}" width="64" height="64" style="display:block;border-radius:4px;object-fit:cover;" />
                             </td>`
              : ''
            }
                      <td style="vertical-align:top;font-size:14px;color:#111827;">
                        <div style="font-weight:600;">${description}</div>
                        <div style="font-size:12px;color:#6b7280;margin-top:2px;">Model: ${sku}</div>
                        <div style="font-size:12px;color:#6b7280;margin-top:4px;">
                          Qty: ${qty}${price != null
              ? ` &nbsp;•&nbsp; Unit: ${formatMoney(price)}`
              : ''
            }
                        </div>
                      </td>
                      <td style="vertical-align:top;text-align:right;font-size:14px;color:#111827;font-weight:600;white-space:nowrap;">
                        ${lineTotal != null
              ? formatMoney(lineTotal)
              : 'TBD'
            }
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            `;
        })
        .join('')
      : `<tr><td style="padding:12px 0;font-size:14px;color:#4b5563;">(No items were attached to this quote.)</td></tr>`;

    const shippingHtml = shipping
      ? `
        <p style="margin:0 0 4px 0;font-size:14px;color:#111827;">${shipping.name || safeName}</p>
        <p style="margin:0 0 2px 0;font-size:13px;color:#4b5563;">
          ${shipping.line1 || ''}
          ${shipping.line2 ? `<br/>${shipping.line2}` : ''}
        </p>
        <p style="margin:0;font-size:13px;color:#4b5563;">
          ${shipping.city || ''}${shipping.city ? ',' : ''} ${shipping.state || ''} ${shipping.zip || ''}
        </p>
      `
      : `
        <p style="margin:0 0 4px 0;font-size:14px;color:#111827;">${safeName}</p>
        <p style="margin:0;font-size:13px;color:#4b5563;">
          Our outlet team will confirm your delivery or pickup details.
        </p>
      `;

    const subtotalFormatted =
      subtotal > 0 ? formatMoney(subtotal) : 'TBD';

    subject = `${APP_NAME} Quote summary`;

    html = `
      <div style="font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f5f5; padding:24px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.10);">
                <tr>
                  <td style="padding:24px 32px 8px 32px;text-align:center;">
                    <!-- Centered logo -->
                    <img
                      src="${FRONTEND_URL}/images/MLD-logo-olive.png"
                      alt="${APP_NAME} logo"
                      style="display:block;margin:0 auto 16px auto;max-width:140px;height:auto;"
                    />
                    <h1 style="margin:0 0 8px 0;font-size:24px;font-weight:700;color:#111827;">
                      Thank you for your order.
                    </h1>
                    <p style="margin:0 0 8px 0;font-size:14px;color:#4b5563;">
                      Our team will review availability, pricing, and delivery options and follow up with you shortly.
                    </p>
                   
                  </td>
                </tr>

                <tr>
                  <td style="padding:16px 32px 24px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr valign="top">
                        <!-- ORDER SUMMARY (left) -->
                        <td width="60%" style="padding-right:16px;">
                          <h2 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#111827;">
                            Order Summary
                          </h2>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                            ${lineItemsHtml}
                          </table>
                        </td>

                        <!-- TOTALS + SHIPPING (right) -->
                        <td width="40%" style="padding-left:16px;border-left:1px solid #e5e7eb;">
                          <h2 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#111827;">
                            Order Total
                          </h2>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;color:#374151;">
                            <tr>
                              <td style="padding:2px 0;">Subtotal</td>
                              <td style="padding:2px 0;text-align:right;font-weight:600;">${subtotalFormatted}</td>
                            </tr>
                            <tr>
                              <td style="padding:2px 0;">Tax</td>
                              <td style="padding:2px 0;text-align:right;">TBD</td>
                            </tr>
                            <tr>
                              <td style="padding:2px 0;">Shipping</td>
                              <td style="padding:2px 0;text-align:right;">TBD</td>
                            </tr>
                            <tr>
                              <td style="padding:6px 0;border-top:1px solid #e5e7eb;font-weight:700;">Estimated Total</td>
                              <td style="padding:6px 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:700;">
                                ${subtotalFormatted}
                              </td>
                            </tr>
                          </table>

                          <h3 style="margin:16px 0 4px 0;font-size:14px;font-weight:600;color:#111827;">
                            Shipping Info
                          </h3>
                          ${shippingHtml}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 32px 20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;font-size:12px;color:#9ca3af;">
                      Thank you for choosing ${APP_NAME}. We appreciate the opportunity to help with your project.
                    </p>
                    <p style="margin:0 0 4px 0;font-size:12px;color:#9ca3af;">
                      <strong>*This email was sent from a no-reply address. Replies are not monitored.</strong>
                    </p>
                    <p style="margin:0 0 12px 0;font-size:12px;color:#9ca3af;">
                      If you need assistance, please call our Outlet Center at <strong>801-466-0990</strong>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;

    // Plain-text version
    const linesText = items.length
      ? items
        .map((item, idx) => {
          const sku =
            item.modelNumber ||
            item.sku ||
            item.acumaticaSku ||
            'Unknown Model';

          const description =
            item.description || item.name || 'Item description';
          const qty = item.quantity ?? 1;
          const price =
            item.price != null ? Number(item.price).toFixed(2) : 'TBD';
          return `${idx + 1}. ${description} (Model: ${sku}) — Qty: ${qty} — Unit: ${price}`;
        })
        .join('\n')
      : '(No items were attached to this quote.)';

    const shippingText = shipping
      ? `${shipping.name || safeName}
${shipping.line1 || ''}${shipping.line2 ? `, ${shipping.line2}` : ''}
${shipping.city || ''}${shipping.city ? ',' : ''} ${shipping.state || ''} ${shipping.zip || ''
      }`
      : `${safeName}
Shipping / pickup details will be confirmed by our outlet team.`;

    text = `Hello ${safeName},

Thank you for your order.

Our team will review availability, pricing, and delivery options and follow up with you shortly.

This email was sent from a no-reply address; replies are not monitored.
If you need assistance, please call our Outlet Center at 801-466-0990.



ORDER SUMMARY
${linesText}

ORDER TOTAL
Subtotal: ${subtotalFormatted}
Tax: TBD
Shipping: TBD
Estimated Total: ${subtotalFormatted}

SHIPPING INFO
${shippingText}

Thank you for choosing ${APP_NAME}.`;

  } else {
    // Account verification (default)
    link = `${FRONTEND_URL}/auth/verify?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(to)}`;
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
