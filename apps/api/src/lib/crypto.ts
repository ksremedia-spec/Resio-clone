/**
 * Password hashing, tokens and signatures. Pure-JS primitives (@noble/hashes)
 * plus the platform's secure random, so the same code runs on the server and
 * inside the browser-only demo build.
 */
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, bytesToHex, utf8 } from './base64.js';

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

function randomBytes(n: number): Uint8Array { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = scrypt(utf8.encode(password), salt, { ...PARAMS, dkLen: KEYLEN });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${bytesToBase64(salt)}$${bytesToBase64(key)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, N, r, p, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !N || !r || !p || !saltB64 || !keyB64) return false;
  const expected = base64ToBytes(keyB64);
  const actual = scrypt(utf8.encode(password), base64ToBytes(saltB64), { N: Number(N), r: Number(r), p: Number(p), dkLen: expected.length });
  return timingSafeEqual(actual, expected);
}

/** Opaque random token (url-safe). The database stores only its hash. */
export function generateToken(bytes = 32): string { return bytesToBase64Url(randomBytes(bytes)); }

export function hashToken(token: string): string { return bytesToHex(sha256(utf8.encode(token))); }

export function sha256Hex(data: Uint8Array | string): string { return bytesToHex(sha256(typeof data === 'string' ? utf8.encode(data) : data)); }

export function sign(payload: string, secret: string): string { return bytesToBase64Url(hmac(sha256, utf8.encode(secret), utf8.encode(payload))); }

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  let given: Uint8Array;
  try { given = base64UrlToBytes(signature); } catch { return false; }
  return timingSafeEqual(hmac(sha256, utf8.encode(secret), utf8.encode(payload)), given);
}

export function slugify(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'org';
}

export function randomUUID(): string { return globalThis.crypto.randomUUID(); }
