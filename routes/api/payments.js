const router = require('express').Router();
const Payment = require('../../models/payment.model');

// Obtener toda la información de pago
router.get('/get-all', async (req, res) => {
    try {
        const payments = await Payment.find();
        res.json(payments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar información de pago
router.put('/update/:id', async (req, res) => {
    try {
        const { beneficiario, clabe, numeroCuenta, banco, concepto } = req.body;
        const payment = await Payment.findOneAndUpdate(
            { id: req.params.id },
            { beneficiario, clabe, numeroCuenta, banco, concepto },
            { new: true, upsert: true }
        );
        res.json(payment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Inicializar datos de pago (ejecutar solo una vez)
router.post('/initialize', async (req, res) => {
    try {
        // Verificar si ya existen registros
        const count = await Payment.countDocuments();
        if (count > 0) {
            return res.status(400).json({ message: 'Los datos de pago ya han sido inicializados' });
        }

        // Crear datos iniciales
        const payments = [
            {
                id: 'payment1',
                beneficiario: 'PLUMASS',
                clabe: '137320105047476844',
                numeroCuenta: '4741 7406 0220 7885',
                banco: 'BanCoppel',
                concepto: ''
            },
            {
                id: 'payment2',
                beneficiario: 'PLUMASS',
                clabe: '012180015714494229',
                numeroCuenta: '4152 3142 9737 3840',
                banco: 'BBVA',
                concepto: ''
            }
        ];

        await Payment.insertMany(payments);
        res.json({ message: 'Datos de pago inicializados correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 