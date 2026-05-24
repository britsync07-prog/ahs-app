import { useCallback } from 'react';
import * as crypto from '../lib/crypto';

export function useWebAuthn() {
  const registerBiometric = useCallback(async (username: string) => {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported in this browser.');
    }

    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const userID = window.crypto.getRandomValues(new Uint8Array(16));

    const creationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'Vault Auth',
        id: window.location.hostname,
      },
      user: {
        id: userID,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256 (P-256)
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged', // 'discouraged' ensures local hardware binding without iCloud/Passkey sync UI
      },
      attestation: 'none',
      timeout: 60000,
    };

    console.log('[DEBUG] WebAuthn Creation Options:', JSON.stringify(creationOptions, null, 2));
    try {
      const credential = (await navigator.credentials.create({
        publicKey: creationOptions,
      })) as any;

      if (!credential) throw new Error('Registration failed: No credential returned');

      console.log('[DEBUG] WebAuthn Registration Successful:', credential.id);
      // Return the credential ID as Base64 so we can use it for authentication
      return crypto.uint8ArrayToBase64(new Uint8Array(credential.rawId));
    } catch (err: any) {
      console.error('[DEBUG] WebAuthn Registration Error:', err);
      throw err;
    }
  }, []);

  const authenticateBiometric = useCallback(async (credentialIdB64: string) => {
    if (!window.PublicKeyCredential) {
      throw new Error('Biometric authentication is not supported.');
    }

    try {
      // NATIVE MIRROR: We don't check availability every time as it's an extra async hop 
      // that can break user gesture on some mobile browsers. We rely on the stored credentialId.
      const challenge = window.crypto.getRandomValues(new Uint8Array(32));
      const credentialId = crypto.base64ToUint8Array(credentialIdB64);

      const requestOptions: PublicKeyCredentialRequestOptions = {
        challenge,
        rpId: window.location.hostname,
        userVerification: 'required',
        allowCredentials: [{
          id: credentialId.buffer as ArrayBuffer,
          type: 'public-key',
          // NATIVE MIRROR: On Android, forcing 'internal' transport can sometimes block 
          // the prompt if the authenticator doesn't explicitly report as internal.
          // We omit it for maximum compatibility across Android Chrome versions.
        }],
        timeout: 60000,
      };

      console.log('[DEBUG] WebAuthn Request Options:', JSON.stringify({
        ...requestOptions,
        challenge: '...',
        allowCredentials: requestOptions.allowCredentials?.map(c => ({ ...c, id: '...' }))
      }, null, 2));

      console.log('[DEBUG] Triggering Targeted Biometric Prompt for ID:', credentialIdB64);
      const assertion = (await navigator.credentials.get({
        publicKey: requestOptions,
      })) as PublicKeyCredential;

      if (!assertion) throw new Error('Authentication failed: No assertion returned');
      console.log('[DEBUG] WebAuthn Authentication Successful');
      return assertion;
    } catch (err: any) {
      console.error('[DEBUG] Biometric Auth Error:', err);
      if (err.name === 'NotAllowedError') {
        throw new Error('Authentication cancelled or timeout.');
      }
      throw err;
    }
  }, []);

  return { registerBiometric, authenticateBiometric };
}
