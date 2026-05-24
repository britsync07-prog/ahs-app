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

  // WebCrypto returns IEEE P1363 format (raw r and s concatenated).
  // Go backend expects ASN.1 DER format.
  const asn1Sig = ieeeToAsn1(new Uint8Array(signature));
  return uint8ArrayToBase64(asn1Sig);
}

/**
 * Converts an IEEE P1363 ECDSA signature (raw r|s) to ASN.1 DER format.
 * Essential for Go/OpenSSL compatibility.
 */
function ieeeToAsn1(ieeeSig: Uint8Array): Uint8Array {
  const r = ieeeSig.slice(0, ieeeSig.length / 2);
  const s = ieeeSig.slice(ieeeSig.length / 2);

  const toAsn1Int = (bytes: Uint8Array) => {
    // Remove leading zeros
    let pos = 0;
    while (pos < bytes.length && bytes[pos] === 0) pos++;
    
    let result = bytes.slice(pos);
    // If MSB is set, prepend 0x00 to keep it positive in ASN.1
    if (result.length > 0 && result[0] >= 0x80) {
      const padded = new Uint8Array(result.length + 1);
      padded.set(result, 1);
      result = padded;
    } else if (result.length === 0) {
      result = new Uint8Array([0]);
    }
    return result;
  };

  const rDer = toAsn1Int(r);
  const sDer = toAsn1Int(s);

  // Construct Sequence: 0x30 [len] 0x02 [rLen] [r] 0x02 [sLen] [s]
  const payload = new Uint8Array(rDer.length + sDer.length + 4);
  payload[0] = 0x02;
  payload[1] = rDer.length;
  payload.set(rDer, 2);
  payload[rDer.length + 2] = 0x02;
  payload[rDer.length + 3] = sDer.length;
  payload.set(sDer, rDer.length + 4);

  const der = new Uint8Array(payload.length + 2);
  der[0] = 0x30;
  der[1] = payload.length;
  der.set(payload, 2);

  return der;
}

/**
 * Hashes a PIN with a salt using SHA-256 to mirror native Android MessageDigest logic.
 */
export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const pinBytes = encoder.encode(pin);
  
  // Combine salt + pin
  const combined = new Uint8Array(salt.length + pinBytes.length);
  combined.set(salt);
  combined.set(pinBytes, salt.length);
  
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', combined);
  return uint8ArrayToBase64(new Uint8Array(hashBuffer));
}

export function generateRandomSalt(length: number = 16): Uint8Array {
  return window.crypto.getRandomValues(new Uint8Array(length));
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
