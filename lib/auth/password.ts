import bcrypt from 'bcryptjs'

export const PASSWORD_ERROR = 'Password must be 8–200 characters and no more than 72 UTF-8 bytes.'

export function validNewPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200
    && Buffer.byteLength(password, 'utf8') <= 72
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function hashPassword(password: string): Promise<string> {
  if (!validNewPassword(password)) {
    throw new Error(PASSWORD_ERROR)
  }
  return bcrypt.hash(password, 12)
}
