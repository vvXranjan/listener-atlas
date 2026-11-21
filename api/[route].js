// One Vercel function for every /api/<route> (shared code lives in server/handlers.mjs).
// One function instead of one per route: fits Vercel's free plan (max 12) and stays warm.
import { nodeHandler } from '../server/adapters.mjs';

export default nodeHandler();
