// Vercel function for /api/song-search (shared code lives in server/handlers.mjs)
import { nodeHandler } from '../server/adapters.mjs';

export default nodeHandler('song-search');
