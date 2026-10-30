/**
 * Vercel Serverless Function: GET /api/trades
 * Fetches trade data from the local cTrader bridge via secure tunnel.
 *
 * Requires BRIDGE_URL environment variable set in Vercel dashboard.
 * Example: https://your-ngrok-domain.ngrok-free.app
 */

export default async function handler(request, response) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }

  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const bridgeUrl = process.env.BRIDGE_URL;

  if (!bridgeUrl) {
    console.error('BRIDGE_URL environment variable not set');
    return response.status(500).json({
      error: 'Configuration error',
      message: 'BRIDGE_URL environment variable is required'
    });
  }

  try {
    // Fetch trades from local bridge
    const fetchUrl = `${bridgeUrl.replace(/\/$/, '')}/api/trades`;
    console.log(`Fetching trades from: ${fetchUrl}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PropJournal-Vercel/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      console.error(`Bridge returned ${res.status}: ${errorText}`);
      return response.status(res.status).json({
        error: 'Bridge error',
        message: `Local bridge returned ${res.status}: ${errorText}`,
        bridgeUrl: fetchUrl
      });
    }

    const trades = await res.json();

    // Validate response is an array
    if (!Array.isArray(trades)) {
      console.error('Bridge returned non-array response');
      return response.status(502).json({
        error: 'Invalid bridge response',
        message: 'Expected array of trades'
      });
    }

    // Add metadata
    const responseData = {
      trades,
      count: trades.length,
      fetchedAt: new Date().toISOString(),
      source: 'ctrader-bridge'
    };

    // Cache for 30 seconds to reduce bridge load
    response.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    response.setHeader('Content-Type', 'application/json');

    return response.status(200).json(responseData);

  } catch (error) {
    console.error('Error fetching trades:', error);

    if (error.name === 'AbortError') {
      return response.status(504).json({
        error: 'Gateway timeout',
        message: 'Local bridge did not respond within 10 seconds'
      });
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return response.status(502).json({
        error: 'Bridge unreachable',
        message: 'Cannot connect to local bridge. Ensure ngrok/Cloudflare tunnel is running.',
        hint: 'Check BRIDGE_URL in Vercel environment variables'
      });
    }

    return response.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Unknown error'
    });
  }
}