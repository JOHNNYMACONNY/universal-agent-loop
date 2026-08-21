import { handleActionRequest } from '../src/app.mjs';

export default async function handler(req, res) {
  const host = req.headers.host;
  const url = new URL(req.url ?? '/', `https://${host ?? 'invalid.local'}`);
  const response = await handleActionRequest({
    method: req.method,
    path: url.pathname,
    searchParams: Object.fromEntries(url.searchParams.entries()),
    body: req.body,
    headers: req.headers,
  });

  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.end(JSON.stringify(response.body));
}
