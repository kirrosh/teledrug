import { createHmac } from "node:crypto";

export interface TelegramAuthUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
  allowsWriteToPm?: boolean;
}

export interface TelegramAuthPayload {
  authDate: number;
  user: TelegramAuthUser;
}

class TelegramAuthError extends Error {}

const buildDataCheckString = (entries: [string, string][]): string =>
  entries
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

const createSecretKey = (botToken: string): Buffer =>
  createHmac("sha256", "WebAppData").update(botToken).digest();

const computeHash = (secret: Buffer, dataCheckString: string): string =>
  createHmac("sha256", secret).update(dataCheckString).digest("hex");

const parseUser = (rawUser: string | undefined): TelegramAuthUser => {
  if (!rawUser) {
    throw new TelegramAuthError("Telegram initData is missing user payload");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawUser);
  } catch (error) {
    throw new TelegramAuthError(`Failed to parse Telegram user payload: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new TelegramAuthError("Telegram user payload has unexpected shape");
  }

  const user = parsed as Record<string, unknown>;

  const id = Number(user.id);
  if (!Number.isInteger(id)) {
    throw new TelegramAuthError("Telegram user id is not a number");
  }

  return {
    id,
    firstName: typeof user.first_name === "string" ? user.first_name : "",
    lastName: typeof user.last_name === "string" ? user.last_name : undefined,
    username: typeof user.username === "string" ? user.username : undefined,
    photoUrl: typeof user.photo_url === "string" ? user.photo_url : undefined,
    languageCode: typeof user.language_code === "string" ? user.language_code : undefined,
    allowsWriteToPm:
      typeof user.allows_write_to_pm === "boolean"
        ? user.allows_write_to_pm
        : undefined,
  } satisfies TelegramAuthUser;
};

export const validateTelegramInitData = (
  initData: string,
  botToken: string,
  maxAuthAgeSeconds = 600,
): TelegramAuthPayload => {
  if (!initData) {
    throw new TelegramAuthError("Telegram initData is empty");
  }

  if (!botToken) {
    throw new TelegramAuthError("TELEGRAM_BOT_TOKEN is not configured on the server");
  }

  const params = new URLSearchParams(initData);
  const entries = Array.from(params.entries());
  const hash = params.get("hash");

  if (!hash) {
    throw new TelegramAuthError("Telegram initData is missing hash");
  }

  const dataCheckString = buildDataCheckString(entries);
  const secret = createSecretKey(botToken);
  const calculatedHash = computeHash(secret, dataCheckString);

  if (calculatedHash !== hash) {
    throw new TelegramAuthError("Telegram initData signature is invalid");
  }

  const authDateParam = params.get("auth_date");
  const authDate = authDateParam ? Number(authDateParam) : NaN;

  if (!Number.isInteger(authDate)) {
    throw new TelegramAuthError("Telegram initData auth_date is invalid");
  }

  if (maxAuthAgeSeconds > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > maxAuthAgeSeconds) {
      throw new TelegramAuthError("Telegram initData is too old");
    }
  }

  const rawUser = params.get("user") ?? undefined;
  const user = parseUser(rawUser);

  return { authDate, user } satisfies TelegramAuthPayload;
};

export class TelegramAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramAuthorizationError";
  }
}

export const mapTelegramAuthError = (error: unknown): TelegramAuthorizationError => {
  if (error instanceof TelegramAuthorizationError) {
    return error;
  }

  if (error instanceof TelegramAuthError) {
    return new TelegramAuthorizationError(error.message);
  }

  return new TelegramAuthorizationError("Unknown Telegram authorization error");
};

