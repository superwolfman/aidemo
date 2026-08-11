import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AuthorizationError, createTenantContext } from '../security/tenantContext.js';
import {
  SessionSecurityError,
  getRequestSessionToken,
  isAllowedCookieOrigin,
  validateUserSession
} from '../security/session.js';

export function requireAuth(store) {
  return async (req, res, next) => {
    const { token, source } = getRequestSessionToken(req);

    if (!token) {
      return res.status(401).json({ message: 'Missing authorization token' });
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const user = (await store.findUserById(payload.sub)) || (payload.email ? await store.findUserByEmail(payload.email) : null);
      validateUserSession(user, payload);
      if (source === 'cookie' && !isAllowedCookieOrigin(req)) {
        return res.status(403).json({ message: 'Request origin is not allowed', code: 'CSRF_ORIGIN_REJECTED' });
      }
      req.user = user;
      req.auth = createTenantContext(user);
      req.session = { payload, source };
      return next();
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof SessionSecurityError) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }
      return res.status(401).json({ message: 'Invalid authorization token' });
    }
  };
}
