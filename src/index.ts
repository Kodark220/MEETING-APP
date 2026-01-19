import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { loadEnv } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { authGoogleRoutes } from "./routes/auth-google.js";
import { authZoomRoutes } from "./routes/auth-zoom.js";
import { zoomWebhookRoutes } from "./routes/webhooks-zoom.js";
import { meetingRoutes } from "./routes/meetings.js";
import { uploadRoutes } from "./routes/upload.js";

const env = loadEnv();
const app = Fastify({ logger: true });

app.register(cookie);
app.register(formbody);
app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

app.get("/", async (_req, reply) => {
  return reply.redirect("/app");
});

app.get("/app", async (_req, reply) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Meeting Decisions</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; max-width: 700px; margin: 0 auto; }
    h1 { margin-bottom: 8px; }
    p { color: #333; }
    a.button { display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; margin-right: 8px; }
    .note { margin-top: 16px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <h1>Meeting Decisions</h1>
  <p>Connect Google Calendar and Zoom to start receiving outcome emails.</p>
  <div>
    <a class="button" href="/auth/google/start">Connect Google</a>
    <a class="button" href="/auth/zoom/start">Connect Zoom</a>
    <a class="button" href="/upload">Upload Recording</a>
  </div>
  <p class="note">Meet recordings are discovered via Google Drive. Run the sync task after meetings.</p>
</body>
</html>`;
  reply.type("text/html").send(html);
});

app.register(healthRoutes, { prefix: "/health" });
app.register(authGoogleRoutes, { prefix: "/auth/google" });
app.register(authZoomRoutes, { prefix: "/auth/zoom" });
app.register(zoomWebhookRoutes, { prefix: "/webhooks/zoom" });
app.register(meetingRoutes, { prefix: "/api" });
app.register(uploadRoutes, { prefix: "/upload" });

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
