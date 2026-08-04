import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AuthorizationError, createTenantContext } from '../security/tenantContext.js';

export function requireAuth(store) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Missing authorization token' });
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = (await store.findUserById(payload.sub)) || (payload.email ? await store.findUserByEmail(payload.email) : null);
      if (!user) return res.status(401).json({ message: 'Invalid user' });
      req.user = user;
      req.auth = createTenantContext(user);
      return next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }
      return res.status(401).json({ message: 'Invalid authorization token' });
    }
  };
}
