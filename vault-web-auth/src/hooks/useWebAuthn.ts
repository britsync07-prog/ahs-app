import { useCallback } from 'react';
import { 
  startRegistration, 
  startAuthentication,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import * as crypto from '../lib/crypto';

/**
 * Checks if WebAuthn is supported in the current environment.
 * Verifies secure context, existence of PublicKeyCredential, non-IP hostnames,
 * and availability of a platform authenticator (TouchID/FaceID).
 */
export async function checkWebAuthnSupport(): Promise<{
  supported: boolean;
  reason?: 'insecure' | 'no-credential' | 'ip-address' | 'no-platform-authenticator' | string;
  details?: string;
}> {
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure',
      details: 'WebAuthn requires a secure context (HTTPS or localhost).',
    };
  }

  if (typeof window.PublicKeyCredential === 'undefined') {
    return {
      supported: false,
      reason: 'no-credential',
      details: 'PublicKeyCredential is not supported by this browser.',
    };
  }

  const hostname = window.location.hostname;
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  const isIpv6 = hostname.includes(':') && /^[0-9a-fA-F:]+$/.test(hostname);
  if (ipv4Regex.test(hostname) || isIpv6) {
    return {
      supported: false,
      reason: 'ip-address',
      details: 'WebAuthn does not support raw IP address hostnames. Use a domain name or localhost.',
    };
  }

  if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'undefined') {
    return {
      supported: false,
      reason: 'no-platform-authenticator',
      details: 'Platform authenticator check is not available in this browser.',
    };
  }

  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return {
        supported: false,
        reason: 'no-platform-authenticator',
        details: 'No platform authenticator (e.g. TouchID/FaceID) is available or enabled on this device.',
      };
    }
  } catch (err: any) {
    return {
      supported: false,
      reason: 'no-platform-authenticator',
      details: `Failed to check platform authenticator availability: ${err.message || err}`,
    };
  }

  return { supported: true };
}

/**
 * Hook for industry-standard WebAuthn biometrics using @simplewebauthn/browser.
 * Follows 'Local-First' patterns sourced from proven GitHub implementations.
 */
export function useWebAuthn() {
  
  const registerBiometric = useCallback(async (username: string) => {
    // Generate a random challenge and user ID locally (Local-First pattern)
    const challenge = crypto.uint8ArrayToBase64(window.crypto.getRandomValues(new Uint8Array(32)));
    const userID = crypto.uint8ArrayToBase64(window.crypto.getRandomValues(new Uint8Array(16)));

    const options: PublicKeyCredentialCreationOptionsJSON = {
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
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      attestation: 'none',
      timeout: 60000,
    };

    console.log('[SimpleWebAuthn] Starting Registration...');
    const registrationResponse = await startRegistration({ optionsJSON: options });
    
    // Modern browsers (WebAuthn L3) provide the public key directly in the response.
    // @simplewebauthn/browser exposes this as 'response.publicKey' (Base64URL).
    const publicKey = registrationResponse.response.publicKey;
    
    if (!publicKey) {
      throw new Error('PublicKey not returned by browser. Ensure you are using a modern browser with WebAuthn L3 support.');
    }

    // Return both ID and Public Key (standard Base64)
    return {
      id: registrationResponse.id,
      publicKey: publicKey.replace(/-/g, '+').replace(/_/g, '/'),
    };
  }, []);

  const authenticateBiometric = useCallback(async (credentialId: string, challenge: string) => {
    const options: PublicKeyCredentialRequestOptionsJSON = {
      challenge,
      rpId: window.location.hostname,
      userVerification: 'required',
      allowCredentials: [{
        id: credentialId,
        type: 'public-key',
      }],
      timeout: 60000,
    };

    console.log('[SimpleWebAuthn] Starting Authentication for ID:', credentialId, 'with challenge:', challenge);
    const authenticationResponse = await startAuthentication({ optionsJSON: options });
    
    // This response contains everything needed for backend verification:
    // id, response (authenticatorData, clientDataJSON, signature)
    return authenticationResponse;
  }, []);

  return { registerBiometric, authenticateBiometric, checkWebAuthnSupport };
}

