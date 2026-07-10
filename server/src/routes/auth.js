import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { verifyPassword } from '../utils/password.js';

function publicUser(user) {
  const { passwordHash, ...safeUser } = user;
  return { ...safeUser, _id: String(safeUser._id) };
}

export function authRouter(store, auth) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    const user = await store.findUserByEmail(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const safeUser = publicUser(user);
    const token = jwt.sign(
      { sub: safeUser._id, email: safeUser.email, role: safeUser.role },
      config.jwtSecret,
      { expiresIn: '8h' }
    );

    return res.json({ token, user: safeUser });
  });

  router.get('/me', auth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
