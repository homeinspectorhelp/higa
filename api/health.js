// api/health.js — lightweight health endpoint for a dashboard/orchestrator.
// GET /api/health → quick liveness + which integrations are configured.
// Does NOT call external APIs (stays fast and side-effect-free); it reports
// whether each integration's credentials are present in the environment.

export default function handler(req, res) {
  const env = process.env;
  res.status(200).json({
    ok: true,
    service: env.HEALTH_SERVICE_NAME || "nikki",
    time: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
    node: process.version,
    integrations: {
      anthropic: !!env.ANTHROPIC_API_KEY,
      github: !!env.GITHUB_TOKEN,
      ghl: !!(env.GHL_API_KEY || env.GHL_CLIENT_ID),
      wordpress: !!(env.WP_SITE_URL && env.WP_APP_PASSWORD),
      monday: !!env.MONDAY_API_KEY,
      telnyx: !!env.TELNYX_API_KEY,
      slack: !!env.SLACK_BOT_TOKEN,
      dean_instant: !!env.DEAN_ROUTINE_FIRE_URL,
    },
  });
}
