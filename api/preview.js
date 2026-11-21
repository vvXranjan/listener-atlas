// Vercel function for /api/preview (shared code lives in server/handlers.mjs)
import { nodeHandler } from '../server/adapters.mjs';

export default nodeHandler('preview');
