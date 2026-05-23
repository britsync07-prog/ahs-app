import { x25519 } from '@noble/curves/ed25519.js';
import * as base64 from 'base64-js';

// --- Utilities ---

export function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferView): string {
  if (buffer instanceof ArrayBuffer) {
    return base64.fromByteArray(new Uint8Array(buffer));
  }
  return base64.fromByteArray(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

export function base64ToArrayBuffer(base64Str: string): ArrayBuffer {
  const bytes = base64.toByteArray(base64Str);
  return bytes.buffer as ArrayBuffer;
}

export function uint8ArrayToBase64(arr: Uint8Array): string {
  return base64.fromByteArray(arr);
}

export function base64ToUint8Array(base64Str: string): Uint8Array {
  return base64.toByteArray(base64Str);
}

// Re-export x25519 for use in other files
export { x25519 };

// --- Identity (ECDSA P-256) ---

export async function generateIdentity(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true, // extractable
    ['sign', 'verify']
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return arrayBufferToBase64(exported);
}

export async function signData(privateKey: CryptoKey, data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const dataToSign = typeof data === 'string' ? encoder.encode(data) : data;

  const signature = await window.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    privateKey,
    dataToSign as any
  );

  return arrayBufferToBase64(signature);
}

// --- X25519 & AES-GCM ---

export function generateX25519KeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Decrypts the master key from desktop.
 * Payload format: 32b Desktop X25519 PK + 12b Nonce + Ciphertext (with 16b tag)
 */
export async function decryptMasterKey(
  encryptedB64: string,
  mobileXPrivateKeyB64: string
): Promise<string> {
  const data = base64ToUint8Array(encryptedB64);
  const mobileXPriv = base64ToUint8Array(mobileXPrivateKeyB64);

  if (data.length < 32 + 12 + 16) {
    throw new Error('Invalid encrypted payload size');
  }

  const desktopXPub = data.slice(0, 32);
  const nonce = data.slice(32, 44);
  const ciphertext = data.slice(44);

  // 1. Compute shared secret (X25519)
  const sharedSecret = x25519.getSharedSecret(mobileXPriv, desktopXPub);

  // 2. Import shared secret as AES-GCM key
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // 3. Decrypt
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    aesKey,
    ciphertext as any
  );

  return arrayBufferToBase64(decrypted);
}

/**
 * Encrypts data for desktop (used when sending the AES key back or approving unlock).
 * Payload format: 32b Mobile X25519 PK + 12b Nonce + Ciphertext (with 16b tag)
 */
export async function encryptForDesktop(
  dataB64: string,
  desktopXPublicKeyB64: string
): Promise<string> {
  const data = base64ToUint8Array(dataB64);
  const desktopXPub = base64ToUint8Array(desktopXPublicKeyB64);

  // 1. Generate ephemeral mobile X25519 key
  const { privateKey: mobileXPriv, publicKey: mobileXPub } = generateX25519KeyPair();

  // 2. Compute shared secret
  const sharedSecret = x25519.getSharedSecret(mobileXPriv, desktopXPub);

  // 3. Import shared secret as AES-GCM key
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // 4. Encrypt
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    aesKey,
    data as any
  );

  // 5. Combine: 32b Mobile XPub + 12b Nonce + Ciphertext
  const finalPayload = new Uint8Array(32 + 12 + encrypted.byteLength);
  finalPayload.set(mobileXPub, 0);
  finalPayload.set(nonce, 32);
  finalPayload.set(new Uint8Array(encrypted), 44);

  return uint8ArrayToBase64(finalPayload);
}
