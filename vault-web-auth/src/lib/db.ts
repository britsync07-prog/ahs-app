import { get, set, del, clear } from 'idb-keyval';

/**
 * Robust persistence layer using 'idb-keyval', the industry standard 
 * for cross-browser IndexedDB management (Sourced from jakearchibald/idb-keyval).
 * This ensures reliability on Android Chrome and iOS Safari.
 */

export interface PairingData {
  desktop_public_key: string;
  desktop_x_public_key: string;
  pairing_nonce: string;
  backend_url: string;
}

class VaultDB {
  // Generic methods
  async get<T>(key: string): Promise<T | null> {
    const val = await get(key);
    return val !== undefined ? (val as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await set(key, value);
  }

  async delete(key: string): Promise<void> {
    await del(key);
  }

  // Specific helpers to match current App usage
  async getIdentityPublicKey() { return this.get<string>('identity_public_key'); }
  async getIdentityPrivateKey() { return this.get<CryptoKey>('identity_private_key'); }
  async getXPrivateKey() { return this.get<string>('x_private_key'); }
  async getMasterKey() { return this.get<string>('master_key'); }
  async getPinHash() { return this.get<string>('pin_hash'); }
  async getPinSalt() { return this.get<string>('pin_salt'); }
  async getDecoyPinHash() { return this.get<string>('decoy_pin_hash'); }
  async getPairingData() { return this.get<PairingData>('pairing_data'); }
  async getBiometricCredentialId() { return this.get<string>('biometric_credential_id'); }
  async getBiometricPublicKey() { return this.get<string>('biometric_public_key'); }
  async isBiometricsEnabled() { return (await this.get<boolean>('biometrics_enabled')) || false; }

  async saveIdentity(pk: string, priv: CryptoKey) {
    await this.set('identity_public_key', pk);
    await this.set('identity_private_key', priv);
  }

  async savePinHash(hash: string, salt: string) {
    await this.set('pin_hash', hash);
    await this.set('pin_salt', salt);
  }

  async saveDecoyPinHash(hash: string) { await this.set('decoy_pin_hash', hash); }
  async setBiometricsEnabled(e: boolean) { await this.set('biometrics_enabled', e); }
  async setBiometricCredentialId(id: string) { await this.set('biometric_credential_id', id); }
  async setBiometricPublicKey(pk: string) { await this.set('biometric_public_key', pk); }
  async saveXPrivateKey(priv: string) { await this.set('x_private_key', priv); }
  async saveMasterKey(key: string) { await this.set('master_key', key); }
  async savePairingData(data: PairingData) { await this.set('pairing_data', data); }

  async clearAll() { await clear(); }
}

export const db = new VaultDB();
