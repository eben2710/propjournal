/**
 * Vercel Serverless Function: GET /api/health
 * Health check endpoint for monitoring.
 */

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }

  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const bridgeUrl = process.env.BRIDGE_URL;
  let bridgeStatus = 'unknown';
  let bridgeTrades = 0;

  if (bridgeUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/api/health`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        bridgeStatus = 'connected';
        bridgeTrades = data.trades || 0;
      } else {
        bridgeStatus = `error_${res.status}`;
      }
    } catch (e) {
      bridgeStatus = 'unreachable';
    }
  } else {
    bridgeStatus = 'not_configured';
  }

  return response.status(200).json({
    ok: true,
    service: 'prop-firm-risk-ledger',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    bridge: {
      status: bridgeStatus,
      tradesCount: bridgeTrades,
      configured: !!bridgeUrl
    },
    uptime: process.uptime()
  });
}