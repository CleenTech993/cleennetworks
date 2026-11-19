export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,72}$/;

export function isStrongPassword(password: string): boolean {
  return STRONG_PASSWORD.test(password) && new TextEncoder().encode(password).byteLength <= 72;
}

export const PASSWORD_REQUIREMENTS =
  "Use at least 8 characters with at least one uppercase letter, one lowercase letter, one number, and one symbol (maximum 72 characters).";
