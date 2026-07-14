// api/proxy.js

export const config = {
  runtime: 'edge', // Edge runtime is perfect for simple streaming pipes.
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Forward the request path and query parameters exactly to Google
    const googleUrl = `https://generativelanguage.googleapis.com${url.pathname}${url.search}`;

    const googleRes = await fetch(googleUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
      },
      body: req.body
    });

    const responseHeaders = new Headers(corsHeaders);
    // Forward the content type (e.g. text/event-stream)
    responseHeaders.set('Content-Type', googleRes.headers.get('Content-Type') || 'application/json');

    return new Response(googleRes.body, {
      status: googleRes.status,
      headers: responseHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}
