import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

export default app;
