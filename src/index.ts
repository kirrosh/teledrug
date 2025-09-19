// Compatibility entrypoint that exposes Effect-based bot
import "./effect/index";

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
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🌐 Health server listening on port ${server.port}`);
