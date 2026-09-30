// Outgoing email (password resets, recovery-email confirmation).
// Set SMTP_URL (e.g. smtps://user:app-password@smtp.gmail.com:465) and MAIL_FROM to send real mail.
// Without SMTP_URL, messages are printed to the server console instead so everything works locally.
let transport = null;
if (process.env.SMTP_URL) transport = require('nodemailer').createTransport(process.env.SMTP_URL);
const FROM = process.env.MAIL_FROM || 'Session Xero <no-reply@localhost>';

async function sendMail(to, subject, text) {
  if (!transport) {
    console.log(`\n[mail] SMTP_URL not set; not sending. To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: FROM, to, subject, text });
}

module.exports = { sendMail, mailConfigured: !!transport };
