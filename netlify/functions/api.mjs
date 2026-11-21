// Netlify function for every /api/* route (shared code lives in server/handlers.mjs)
import { webHandler } from '../../server/adapters.mjs';

export default webHandler;

export const config = { path: '/api/*' };
