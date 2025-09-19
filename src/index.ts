// Compatibility entrypoint that exposes Effect-based bot
import "./effect/index";

// Optional lightweight healthcheck server for Railway
const port = Number(process.env.PORT || 3000);

Bun.serve({
  port,
  fetch: (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/health") {
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
