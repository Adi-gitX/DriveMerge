const jwt = require('jsonwebtoken');

const SECRET = process.env.DM_JWT_SECRET || 'drivemerge-dev-secret';
const TOKEN_EXP = process.env.DM_JWT_EXP || '7d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: TOKEN_EXP });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

// express middleware to require auth; sets req.user = { userId }
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' });
  const token = auth.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'invalid token' });
  req.user = payload;
  next();
}

module.exports = { signToken, verifyToken, requireAuth };
