import { authenticator } from 'otplib';

const ISSUER = 'PracticeRoom';

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI that an authenticator app turns into a QR code. */
export function totpKeyUri(accountName: string, secret: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
