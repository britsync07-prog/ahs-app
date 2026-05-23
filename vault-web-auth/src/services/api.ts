export async function pairDevice(
  backendUrl: string,
  desktopPK: string,
  mobilePK: string,
  mobileXPK: string,
  nonce: string,
  signature: string
) {
  const response = await fetch(`${backendUrl}/api/vault/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      desktop_public_key: desktopPK,
      mobile_public_key: mobilePK,
      mobile_x_public_key: mobileXPK,
      pairing_nonce: nonce,
      signature: signature,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pairing failed: ${error}`);
  }

  return await response.json();
}

export async function registerDevice(
  backendUrl: string,
  publicKey: string,
  name: string,
  os: string
) {
  const response = await fetch(`${backendUrl}/api/vault/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      public_key: publicKey,
      name: name,
      os: os,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Registration failed: ${error}`);
  }

  return await response.json();
}

export async function sendUnlockApproval(
  backendUrl: string,
  desktopPK: string,
  mobilePK: string,
  nonce: string,
  signature: string,
  encryptedBlob: string
) {
  const response = await fetch(`${backendUrl}/api/vault/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_public_key: desktopPK,
      mobile_public_key: mobilePK,
      pairing_nonce: nonce,
      signature: signature,
      encrypted_blob: encryptedBlob,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Unlock approval failed: ${error}`);
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
