const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

router.post('/logout', ctrl.logout);
router.get('/me', requireAuth, ctrl.me);
router.post('/login-guard', ctrl.loginGuard);
router.post('/login-fail', ctrl.loginFail);
router.post('/login-ok', ctrl.loginOk);

module.exports = router;
