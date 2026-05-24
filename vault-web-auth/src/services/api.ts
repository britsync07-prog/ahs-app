/**
 * API Service for Vault Authentication.
 * Sourced from proven patterns for cross-platform WebAuthn/Mobile parity.
 */

export interface WebAuthnAssertion {
  id: string;
  rawId: string;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle?: string;
  };
  type: string;
}

export async function pairDevice(
  backendUrl: string,
  desktopPK: string,
  mobilePK: string,
  mobileXPK: string,
  nonce: string,
  signature: string,
  webauthnResponse?: any
) {
  const response = await fetch(`${backendUrl}/api/web/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      desktop_public_key: desktopPK,
      mobile_public_key: mobilePK,
      mobile_x_public_key: mobileXPK,
      pairing_nonce: nonce,
      signature: signature,
      webauthn_response: webauthnResponse, // NEW: Full WebAuthn assertion
      os_info: navigator.userAgent
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(err || 'Pairing failed');
  }

  return await response.json();
}

export async function sendUnlockApproval(
  backendUrl: string,
  desktopPK: string,
  mobilePK: string,
  nonce: string,
  signature: string,
  encryptedBlob: string,
  webauthnResponse?: any
) {
  const response = await fetch(`${backendUrl}/api/web/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_public_key: desktopPK,
      mobile_public_key: mobilePK,
      pairing_nonce: nonce,
      signature: signature,
      encrypted_blob: encryptedBlob,
      webauthn_response: webauthnResponse // NEW: Full WebAuthn assertion
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to send unlock approval');
  }

  return await response.json();
}

export async function getVaultStats(backendUrl: string, publicKey: string) {
  const response = await fetch(`${backendUrl}/api/vault/stats?public_key=${encodeURIComponent(publicKey)}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch vault stats: ${response.status}`);
  }

  return await response.json();
}
