import { JournalClient } from "@/app/journal/_components/JournalClient";
import { fetchJournalEntriesForUser } from "@/actions/journal";
import { buildSessionPayload, getReadonlySession } from "@/lib/session";

export default async function JournalPage() {
  const session = await getReadonlySession();
  const sessionPayload = buildSessionPayload(session);

  const initialEntries = sessionPayload.isAuthorized && sessionPayload.telegram
    ? await fetchJournalEntriesForUser(sessionPayload.telegram.id)
    : [];

  return <JournalClient initialSession={sessionPayload} initialEntries={initialEntries} />;
}

