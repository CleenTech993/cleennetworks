import nodemailer from "nodemailer";

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-=?";

function randomIndex(max: number): number {
  const limit = Math.floor(256 / max) * max;
  const bytes = new Uint8Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0]! >= limit);
  return bytes[0]! % max;
}

export function generateTemporaryPassword(length = 18): string {
  if (!Number.isInteger(length) || length < 12 || length > 72) {
    throw new Error("Temporary password length must be between 12 and 72 characters.");
  }

  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%&*+-=?",
  ];
  const chars = groups.map((group) => group[randomIndex(group.length)]!);
  while (chars.length < length) {
    chars.push(PASSWORD_CHARS[randomIndex(PASSWORD_CHARS.length)]!);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendTeamCredentialsEmail(input: {
  recipient: string;
  firstName: string;
  email: string;
  temporaryPassword: string;
}): Promise<void> {
  const host = process.env["SMTP_HOST"]?.trim();
  const port = Number(process.env["SMTP_PORT"] ?? 587);
  const from = process.env["SMTP_FROM"]?.trim();
  const user = process.env["SMTP_USER"]?.trim();
  const password = process.env["SMTP_PASS"];
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Team email delivery is not configured.");
  }
  if ((user && !password) || (!user && password)) {
    throw new Error("Team email authentication is incomplete.");
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env["SMTP_SECURE"] === "true" || port === 465,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  });
  try {
    const firstName = escapeHtml(input.firstName);
    const email = escapeHtml(input.email);
    const temporaryPassword = escapeHtml(input.temporaryPassword);
    await transport.sendMail({
      from,
      to: input.recipient,
      subject: "Your NetGrid team account",
      text: [
        `Hello ${input.firstName},`,
        "",
        "Your team account is ready.",
        `Sign-in email: ${input.email}`,
        `Temporary password: ${input.temporaryPassword}`,
        "",
        "Sign in to NetGrid. You will be asked to create a new password before continuing.",
      ].join("\n"),
      html: `<p>Hello ${firstName},</p><p>Your team account is ready.</p><p><strong>Sign-in email:</strong> ${email}<br><strong>Temporary password:</strong> ${temporaryPassword}</p><p>Sign in to NetGrid. You will be asked to create a new password before continuing.</p>`,
    });
  } finally {
    transport.close();
  }
}
