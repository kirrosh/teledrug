import { TasksClient } from "@/app/tasks/_components/TasksClient";
import { fetchTasksForUser } from "@/actions/tasks";
import { buildSessionPayload, getReadonlySession } from "@/lib/session";

export default async function TasksPage() {
  const session = await getReadonlySession();
  const sessionPayload = buildSessionPayload(session);

  const initialTasks = sessionPayload.isAuthorized && sessionPayload.telegram
    ? await fetchTasksForUser(sessionPayload.telegram.id)
    : [];

  return <TasksClient initialSession={sessionPayload} initialTasks={initialTasks} />;
}

