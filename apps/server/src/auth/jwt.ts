import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';

export interface SessionClaims {
  /** Application user id (MongoDB ObjectId string). */
  sub: string;
}

export interface SessionToken {
  token: string;
  expiresAt: Date;
}

const ISSUER = 'rivalrush';
const AUDIENCE = 'rivalrush-app';

export function issueSession(userId: string, secret: string, ttlSeconds: number): SessionToken {
  const token = jwt.sign({}, secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: ttlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { token, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
}

export function verifySession(token: string | undefined | null, secret: string): SessionClaims {
  if (!token) throw new AppError('UNAUTHORIZED');
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string' || !decoded.sub) {
      throw new AppError('UNAUTHORIZED');
    }
    return { sub: decoded.sub };
  } catch {
    throw new AppError('UNAUTHORIZED');
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header.trim());
  return match ? match[1]! : null;
}
