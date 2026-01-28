const router = require('express').Router();

router.use('/users', require('./api/user'));
router.use('/mensajes', require('./api/mensajes'));
router.use('/streams', require('./api/streams'));
router.use('/videos', require('./api/videos'));
router.use('/recibos', require('./api/recipes'));
router.use('/scripts', require('./api/scripts'));
router.use('/apuestas', require('./api/apuestas'));
router.use('/retiros', require('./api/retiros'));
router.use('/payments', require('./api/payments'));
router.use('/saldos', require('./api/saldos'));
router.use('/screenshot', require('./api/screenshot'));
router.use('/ruleta', require('./api/ruleta'));
router.use('/rifas', require('./api/rifa'));
router.use('/corte-diario', require('./api/corteDiario'));
router.use('/tabla', require('./api/tabla'));
router.use('/settings', require('./api/settings'));
router.use('/reports', require('./api/reports'));

module.exports = router;