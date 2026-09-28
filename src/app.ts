import { Hono } from 'hono';

// src/app.ts is the Flue route map. Its default export owns every HTTP request
// the Worker receives. Agents get mounted here with createAgentRouter(...)
// starting in checkpoint 1.
const app = new Hono();

app.get('/api/ping', (c) => c.text('pong'));

export default app;
