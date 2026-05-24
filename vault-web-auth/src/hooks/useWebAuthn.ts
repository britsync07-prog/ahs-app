import { useCallback } from 'react';

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
        name: 'Secure Vault',
        id: window.location.hostname,
      },
      user: {
        id: userID,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        {
          type: 'public-key',
          alg: -7, // ES256
        },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // TouchID, FaceID, Windows Hello
        userVerification: 'required',
      },
      timeout: 60000,
    };

    const credential = (await navigator.credentials.create({
      publicKey: creationOptions,
    })) as PublicKeyCredential;

    return credential;
  }, []);

  const authenticateBiometric = useCallback(async () => {
    if (!window.PublicKeyCredential) {
      throw new Error('Biometric authentication is not supported on this device/browser.');
    }

    try {
      // Check if platform authenticator is available (FaceID/TouchID)
      console.log('Checking biometric availability...');
      const isAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!isAvailable) {
        throw new Error('Face ID or Touch ID is not available or enabled on this device.');
      }

      const challenge = window.crypto.getRandomValues(new Uint8Array(32));

      const requestOptions: PublicKeyCredentialRequestOptions = {
        challenge,
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60000,
      };

      console.log('Triggering system biometric prompt...');
      const assertion = (await navigator.credentials.get({
        publicKey: requestOptions,
      })) as PublicKeyCredential;

      if (!assertion) {
        throw new Error('No biometric credential found. Please enroll biometrics in Security Setup first.');
      }

      return assertion;
    } catch (err: any) {
      console.error('Biometric authentication error:', err);
      if (err.name === 'NotAllowedError') {
        throw new Error('Authentication cancelled or biometric data not recognized.');
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No registered biometrics found on this device. Please use PIN or re-enroll in Settings.');
      }
      throw err;
    }
  }, []);

  return { registerBiometric, authenticateBiometric };
}
