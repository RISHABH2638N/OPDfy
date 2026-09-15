import nodemailer from "nodemailer";

function getMailConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
    port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.OTP_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;
  const fromName = process.env.OTP_FROM_NAME || "OPDfy";

  if (!host || !user || !pass || !fromEmail) {
    throw new Error("SMTP configuration is incomplete.");
  }

  return { host, port, secure, user, pass, fromEmail, fromName };
}

function createTransporter() {
  const config = getMailConfig();

  return {
    config,
    transporter: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      disableFileAccess: true,
      disableUrlAccess: true,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    }),
  };
}

export async function sendEmail({ to, subject, text, html }) {
  const { config, transporter } = createTransporter();

  return transporter.sendMail({
    from: {
      name: config.fromName,
      address: config.fromEmail,
    },
    to,
    subject,
    text,
    html,
  });
}

export async function sendOtpEmail(email, otp) {
  const text =
    `Your OPDfy verification code is ${otp}. ` +
    "This code expires in 5 minutes. Do not share it with anyone.";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#172033">
      <h2 style="margin:0 0 12px">OPDfy</h2>
      <p>Your verification code is:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;margin:18px 0">${otp}</div>
      <p style="color:#64748b">This code expires in 5 minutes. Do not share it with anyone.</p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: "Your OPDfy verification code",
    text,
    html,
  });
}

export async function sendPatientNotificationEmail(email, title, message) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const safeTitle = String(title || "OPDfy update");
  const safeMessage = String(message || "");

  return sendEmail({
    to: email,
    subject: safeTitle,
    text: `${safeTitle}\n\n${safeMessage}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#172033">
        <div style="font-size:13px;font-weight:700;color:#2563eb;margin-bottom:8px">OPDfy</div>
        <h2 style="margin:0 0 14px">${escape(safeTitle)}</h2>
        <p style="font-size:15px;line-height:1.7">${escape(safeMessage)}</p>
        <p style="margin-top:24px;color:#64748b;font-size:12px">
          This is an automated hospital queue notification.
        </p>
      </div>
    `,
  });
}
