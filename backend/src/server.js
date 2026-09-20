require('dotenv').config({ override: true });
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const { supabase, supabaseAnon } = require('./config/supabase');
const botManager = require('./services/botManager');
const baileysManager = require('./services/baileysManager');

const authRoutes = require('./routes/auth.routes');
const catalogRoutes = require('./routes/catalog.routes');
const botsRoutes = require('./routes/bots.routes');
const adminRoutes = require('./routes/admin.routes');
const paymentsRoutes = require('./routes/payments.routes');
const billing = require('./services/billing');
const { startUploadsJanitor } = require('./services/uploadsJanitor');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
// Réduit un peu l’accès aux APIs de debug navigateur (pas un vrai verrou)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const loginAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessaie plus tard.' },
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth/login-guard', loginAttemptLimiter);
app.use('/api/auth/login-fail', loginAttemptLimiter);
app.use('/api/auth/login-ok', loginAttemptLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/bots', botsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', paymentsRoutes);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('unauthorized'));
    const { data: authData, error } = await supabaseAnon.auth.getUser(token);
    if (error || !authData?.user) return next(new Error('unauthorized'));
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, role, blocked')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (!profile || profile.blocked) return next(new Error('unauthorized'));
    socket.user = profile;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.on('join-bot', async (botId) => {
    let query = supabase.from('bots').select('id, plan_code').eq('id', botId);
    if (socket.user.role !== 'admin') query = query.eq('user_id', socket.user.id);
    const { data: rows } = await query.maybeSingle();
    if (rows) {
      socket.join(botManager.room(botId));
      const manager = rows.plan_code === 'vue_unique' ? baileysManager : botManager;
      manager.sendSnapshot(socket, botId);
    }
  });
});

botManager.init(io);
botManager.restoreActiveSessions();
baileysManager.init(io);
baileysManager.restoreActiveSessions();
billing.startBillingJob();
startUploadsJanitor();

const PORT = process.env.PORT || 5010;
const publicBase = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
server.listen(PORT, () => {
  console.log(`HEXARO backend démarré sur le port ${PORT}`);
  console.log(`HexaPay callback → ${publicBase}/api/hexapay/callback`);
});
