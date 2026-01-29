const express = require('express');
const router = express.Router();
const { sendActivityReport } = require('../../services/email.service');

/**
 * @route   POST /api/reports/send
 * @desc    Dispara manualmente el envío del correo con el reporte de actividad.
 * @access  Private (Importante: Deberías proteger esta ruta en el futuro)
 */
router.post('/send', async (req, res) => {
    try {
        const result = await sendActivityReport();
        res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error al enviar reporte:', error);
        res.status(500).json({ success: false, message: error.message || 'Error interno del servidor.' });
    }
});

module.exports = router;
