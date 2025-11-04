import { Effect, Layer } from 'effect';

/**
 * Save Google Calendar tokens to database
 * This is a placeholder that will use the UserRepository from @teledrug/core
 * For now, we'll implement a direct database call
 */
export async function saveGoogleCalendarTokens(
  userId: number,
  credentials: {
    accessToken: string;
    refreshToken?: string;
    expiryDate: number;
    scope: string;
    tokenType: string;
  }
): Promise<void> {
  // Import database and encryption services dynamically
  const { db, userIntegrations } = await import('@teledrug/db');
  const { EncryptionService, EncryptionServiceLive } = await import('@teledrug/encryption');

  // Create encryption service
  const encryptionEffect = Effect.gen(function* () {
    const encryption = yield* EncryptionService;

    // Encrypt credentials
    const encrypted = yield* encryption.encryptJson(credentials);

    return encrypted;
  });

  // Run encryption
  const encrypted = await Effect.runPromise(
    encryptionEffect.pipe(Effect.provide(EncryptionServiceLive))
  );

  // Check if integration already exists
  const existing = await db
    .select()
    .from(userIntegrations)
    .where((eb: any) =>
      eb.and([
        eb.eq(userIntegrations.userId, userId),
        eb.eq(userIntegrations.integrationType, 'GoogleCalendar'),
      ])
    )
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing integration
    await db
      .update(userIntegrations)
      .set({
        credentialsEncrypted: encrypted.encrypted,
        credentialsIv: encrypted.iv,
        credentialsTag: encrypted.tag,
        enabled: true,
        updatedAt: new Date(),
        settings: {
          connectedAt: new Date().toISOString(),
        },
      })
      .where((eb: any) =>
        eb.and([
          eb.eq(userIntegrations.userId, userId),
          eb.eq(userIntegrations.integrationType, 'GoogleCalendar'),
        ])
      );
  } else {
    // Create new integration
    await db.insert(userIntegrations).values({
      userId,
      integrationType: 'GoogleCalendar',
      credentialsEncrypted: encrypted.encrypted,
      credentialsIv: encrypted.iv,
      credentialsTag: encrypted.tag,
      enabled: true,
      settings: {
        connectedAt: new Date().toISOString(),
      },
    });
  }
}
