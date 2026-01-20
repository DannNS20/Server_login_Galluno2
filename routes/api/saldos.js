const router = require('express').Router();
const saldos = require('../../models/saldos.model');

router.get('/obtener-registros-saldos', async (req, res) => {
    const registros = await saldos.find();
    res.json(registros);
});

router.get('/obtener-registros-por-usuario/:usuario', async (req, res) => {
    const registros = await saldos.find({usuario: req.params.usuario});
    res.json(registros);
});

router.get('/obtener-registros-por-fecha', async (req, res) => {
    try {
        const fechaParam = req.params.fecha;
        
        // Create start of day (00:00:00.000Z)
        const startOfDay = new Date(fechaParam);
        startOfDay.setUTCHours(0, 0, 0, 0);
        
        // Create end of day (23:59:59.999Z)
        const endOfDay = new Date(fechaParam);
        endOfDay.setUTCHours(23, 59, 59, 999);
        
        // Search for records within the day range
        const registros = await saldos.find({
            fecha: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        });
        
        res.json(registros);
    } catch (error) {
        console.error('Error searching records by date:', error);
        res.status(500).json({ error: 'Error searching records by date' });
    }
});
module.exports = router;