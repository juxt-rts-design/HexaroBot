const DAREPAY_BASE_URL = (process.env.DAREPAY_BASE_URL || 'https://darepay.devetu.org/api').replace(/\/$/, '');
const DAREPAY_API_KEY = process.env.DAREPAY_API_KEY || '';

async function darepayFetch(path, options = {}) {
  if (!DAREPAY_API_KEY) {
    const err = new Error('Service de paiement indisponible. Réessayez plus tard.');
    err.status = 503;
    throw err;
  }

  const res = await fetch(`${DAREPAY_BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': DAREPAY_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  return { status: res.status, ok: res.ok, body };
}

function extractPayment(body) {
  return body?.payment || body?.data || null;
}

module.exports = {
  darepayFetch,
  extractPayment,
  DAREPAY_BASE_URL,
};
