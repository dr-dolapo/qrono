interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

/**
 * Serves the React app from static assets and forwards /api/* (including the
 * live-event WebSocket) to the qrono-api Worker through a service binding.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
