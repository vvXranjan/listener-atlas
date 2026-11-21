// Vercel function for /api/audio (shared code lives in server/handlers.mjs)
import { nodeHandler } from '../server/adapters.mjs';

export default nodeHandler('audio');
