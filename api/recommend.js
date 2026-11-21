// Vercel function for /api/recommend (shared code lives in server/handlers.mjs)
import { nodeHandler } from '../server/adapters.mjs';

export default nodeHandler('recommend');
