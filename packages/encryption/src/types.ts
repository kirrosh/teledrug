export interface EncryptedData {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
}
