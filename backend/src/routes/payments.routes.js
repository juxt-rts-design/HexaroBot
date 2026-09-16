const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/payments.controller');
const { requireAuth } = require('../middleware/auth');

const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de paiement. Réessaie plus tard.' },
});

router.get('/billing/me', requireAuth, ctrl.getBillingMe);
router.post('/payments', requireAuth, payLimiter, ctrl.createPayment);
router.get('/payments/:reference/status', requireAuth, ctrl.getPaymentStatus);
router.post('/hexapay/callback', ctrl.hexapayCallback);

module.exports = router;
