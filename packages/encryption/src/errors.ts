import { Data } from "effect";

export class CryptographyError extends Data.TaggedError("CryptographyError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class EncryptionError {
  readonly _tag = "EncryptionError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class DecryptionError {
  readonly _tag = "DecryptionError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}
