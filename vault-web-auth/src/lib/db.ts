const DB_NAME = 'VaultAuthDB';
const DB_VERSION = 1;
const STORE_NAME = 'settings';

export interface PairingData {
  desktop_public_key: string;
  desktop_x_public_key: string;
  pairing_nonce: string;
  backend_url: string;
}

class VaultDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  async get<T>(key: string): Promise<T | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Helper methods for specific items

  async getIdentityPublicKey(): Promise<string | null> {
    return this.get<string>('identity_public_key');
  }

  async getIdentityPrivateKey(): Promise<CryptoKey | null> {
    return this.get<CryptoKey>('identity_private_key');
  }

  async getXPrivateKey(): Promise<string | null> {
    return this.get<string>('x_private_key');
  }

  async getMasterKey(): Promise<string | null> {
    return this.get<string>('master_key');
  }

  async getPinHash(): Promise<string | null> {
    return this.get<string>('pin_hash');
  }

  async getPinSalt(): Promise<string | null> {
    return this.get<string>('pin_salt');
  }

  async getDecoyPinHash(): Promise<string | null> {
    return this.get<string>('decoy_pin_hash');
  }

  async getPairingData(): Promise<PairingData | null> {
    return this.get<PairingData>('pairing_data');
  }

  async saveIdentity(publicKey: string, privateKey: CryptoKey): Promise<void> {
    await this.set('identity_public_key', publicKey);
    await this.set('identity_private_key', privateKey);
  }

  async savePinHash(hash: string, salt: string): Promise<void> {
    await this.set('pin_hash', hash);
    await this.set('pin_salt', salt);
  }

  async saveDecoyPinHash(hash: string): Promise<void> {
    await this.set('decoy_pin_hash', hash);
  }

  async saveXPrivateKey(privateKey: string): Promise<void> {
    await this.set('x_private_key', privateKey);
  }

  async saveMasterKey(key: string): Promise<void> {
    await this.set('master_key', key);
  }

  async savePairingData(data: PairingData): Promise<void> {
    await this.set('pairing_data', data);
  }

  async clearAll(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const db = new VaultDB();
