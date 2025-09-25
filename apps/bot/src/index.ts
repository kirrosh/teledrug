import "@teledrug/core/effect/index";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const shouldStartHealthServer = parseBoolean(
  process.env.BOT_HEALTH_SERVER_ENABLED,
  true,
);

if (shouldStartHealthServer) {
  const port = Number(process.env.PORT || 3000);

  const server = Bun.serve({
    port,
    fetch: (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/") {
        return new Response("TeleDrug bot is running", { status: 200 });
      }

      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`🌐 Health server listening on port ${server.port}`);
} else {
  console.log("🌐 Bot health server disabled (BOT_HEALTH_SERVER_ENABLED=false)");
}
