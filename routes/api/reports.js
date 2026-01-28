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
        console.log('[API] Solicitud manual de envío de reporte recibida.');
        // Llama a la función que hemos definido en el servicio de correo.
        const result = await sendActivityReport();
        res.status(200).json(result);
    } catch (error) {
        // Si algo sale mal en el servicio, el error se captura aquí.
        console.error('Error al intentar enviar el reporte manualmente:', error);
        res.status(500).json({ success: false, message: error.message || 'Error interno del servidor.' });
    }
});

module.exports = router;
