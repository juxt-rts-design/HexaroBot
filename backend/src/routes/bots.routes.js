const router = require('express').Router();
const ctrl = require('../controllers/bots.controller');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/mine', ctrl.listMine);
router.post('/', ctrl.create);
router.post('/:id/disconnect', ctrl.disconnect);
router.post('/:id/reconnect', ctrl.reconnect);
router.get('/:id/connect-state', ctrl.connectState);
router.post('/:id/pairing-code', ctrl.requestPairingCode);
router.get('/:id/settings', ctrl.getSettings);
router.put('/:id/settings', ctrl.updateSettings);

module.exports = router;
