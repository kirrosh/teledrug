import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const masterKey = process.env.ENCRYPTION_MASTER_KEY;

    if (!masterKey) {
      // Generate a random key for development if not provided
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ No ENCRYPTION_MASTER_KEY found, generating a temporary key for development');
        this.key = randomBytes(32);
        console.log(`Generated key (hex): ${this.key.toString('hex')}`);
      } else {
        throw new Error('ENCRYPTION_MASTER_KEY is required in production');
      }
    } else if (masterKey.length !== 64) {
      throw new Error('ENCRYPTION_MASTER_KEY must be exactly 64 hex characters (32 bytes)');
    } else {
      this.key = Buffer.from(masterKey, 'hex');
    }
  }

  encrypt(text: string): EncryptedData {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  decrypt(encrypted: string, iv: string, tag: string): string {
    const decipher = createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // Helper method to encrypt JSON objects
  encryptJson(obj: Record<string, any>): EncryptedData {
    return this.encrypt(JSON.stringify(obj));
  }

  // Helper method to decrypt JSON objects
  decryptJson(encrypted: string, iv: string, tag: string): Record<string, any> {
    const decrypted = this.decrypt(encrypted, iv, tag);
    return JSON.parse(decrypted);
  }
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    encryptionService = new EncryptionService();
  }
  return encryptionService;
}