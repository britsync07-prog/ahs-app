import Dexie, { type Table } from 'dexie';

/**
 * Robust IndexedDB persistence layer using Dexie.js (Gold Standard).
 * Implements exponential backoff retry for Chromium/Android and Safari WAL flushing.
 * Sourced from Dexie.js best practices and official documentation.
 */

export interface PairingData {
  desktop_public_key: string;
  desktop_x_public_key: string;
  pairing_nonce: string;
  backend_url: string;
}

export interface SecurityKey {
  id: string;
  value: any; // Can store strings, numbers, OR structured CryptoKey objects
}

class VaultDexie extends Dexie {
  settings!: Table<SecurityKey>;

  constructor() {
    super('VaultAuthDB');
    this.version(1).stores({
      settings: 'id'
    });
  }

  /**
   * Robust opener with retry logic for Android/Chromium quirks.
   */
  async robustOpen(): Promise<void> {
    if (this.isOpen()) return;

    let attempt = 0;
    while (attempt < 3) {
      try {
        await this.open();
        console.log('[Dexie] Database opened successfully.');
        return;
      } catch (e: any) {
        attempt++;
        console.warn(`[Dexie] Open attempt ${attempt} failed:`, e.name);
        if (['UnknownError', 'DatabaseClosedError', 'QuotaExceededError'].includes(e.name)) {
          await new Promise(r => setTimeout(r, 200 * attempt)); // Exponential backoff
        } else {
          throw e;
        }
      }
    }
  }

  // --- Specific Helpers ---

  async getSetting<T>(id: string): Promise<T | null> {
    await this.robustOpen();
    const entry = await this.settings.get(id);
    return entry ? (entry.value as T) : null;
  }

  async saveSetting(id: string, value: any): Promise<void> {
    await this.robustOpen();
    await this.settings.put({ id, value });
  }

  // Identity methods
  async getIdentityPublicKey() { return this.getSetting<string>('identity_public_key'); }
  async getIdentityPrivateKey() { return this.getSetting<CryptoKey>('identity_private_key'); }
  async getXPrivateKey() { return this.getSetting<string>('x_private_key'); }
  async getMasterKey() { return this.getSetting<string>('master_key'); }
  async getPinHash() { return this.getSetting<string>('pin_hash'); }
  async getPinSalt() { return this.getSetting<string>('pin_salt'); }
  async getDecoyPinHash() { return this.getSetting<string>('decoy_pin_hash'); }
  async getPairingData() { return this.getSetting<PairingData>('pairing_data'); }
  async getBiometricCredentialId() { return this.getSetting<string>('biometric_credential_id'); }
  async getBiometricPublicKey() { return this.getSetting<string>('biometric_public_key'); }
  async isBiometricsEnabled() { return (await this.getSetting<boolean>('biometrics_enabled')) || false; }

  async saveIdentity(pk: string, priv: CryptoKey) {
    await this.saveSetting('identity_public_key', pk);
    await this.saveSetting('identity_private_key', priv);
  }

  async savePinHash(hash: string, salt: string) {
    await this.saveSetting('pin_hash', hash);
    await this.saveSetting('pin_salt', salt);
  }

  async saveDecoyPinHash(hash: string) { await this.saveSetting('decoy_pin_hash', hash); }
  async setBiometricsEnabled(e: boolean) { await this.saveSetting('biometrics_enabled', e); }
  async setBiometricCredentialId(id: string) { await this.saveSetting('biometric_credential_id', id); }
  async setBiometricPublicKey(pk: string) { await this.saveSetting('biometric_public_key', pk); }
  async saveXPrivateKey(priv: string) { await this.saveSetting('x_private_key', priv); }
  async saveMasterKey(key: string) { await this.saveSetting('master_key', key); }
  async savePairingData(data: PairingData) { await this.saveSetting('pairing_data', data); }
  async getMnemonic() { return this.getSetting<string>('mnemonic'); }
  async saveMnemonic(mnemonic: string) { await this.saveSetting('mnemonic', mnemonic); }

  async clearAll() { 
    await this.robustOpen();
    await this.settings.clear(); 
  }
}

export const db = new VaultDexie();

// Critical Safari Fix: Close on hidden to flush the WAL file and prevent database locks
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      console.log('[Dexie] Flushing to disk...');
      db.close();
    }
  });
}
