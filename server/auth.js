import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'thacklebox-dev-secret-change-in-prod';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name, avatar_color: user.avatar_color },
    SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = verifyToken(header.slice(7));
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = user;
  next();
}
