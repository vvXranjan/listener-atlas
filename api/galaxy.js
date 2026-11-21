// Vercel function for /api/galaxy (shared code lives in server/handlers.mjs)
import { nodeHandler } from '../server/adapters.mjs';

export default nodeHandler('galaxy');
