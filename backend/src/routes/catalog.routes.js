const router = require('express').Router();
const ctrl = require('../controllers/catalog.controller');
const { requireAuth } = require('../middleware/auth');

router.get('/plans', ctrl.listPlans);
router.post('/subscriptions', requireAuth, ctrl.createSubscription);
router.get('/subscriptions/mine', requireAuth, ctrl.listMySubscriptions);

module.exports = router;
