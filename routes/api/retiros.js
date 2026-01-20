const router = require('express').Router();
const Retiro = require('../../models/retiro.model');
const User = require('../../models/user.model');
const twilio = require('twilio');
const accountSid = 'AC440e20d4cad728317506ac0f342a6bd4';
const authToken = 'c45cb9815f3ccb46e3e2eee0888fced1';
const client = twilio(accountSid, authToken);

// POST /api/retiros/solicitar

router.post('/solicitar', async (req, res) => {
    try {
        const { username, banco, cantidad, nombreTitular, numeroTarjeta } = req.body;

        // Validaciones básicas
        if (!username || !banco || !cantidad || !nombreTitular || !numeroTarjeta) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        if (cantidad <= 0) {
            return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
        }

        // Verificar si el usuario existe y tiene saldo suficiente
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (user.saldo < cantidad) {
            return res.status(400).json({ error: 'Saldo insuficiente para realizar el retiro' });
        }

        // Crear la solicitud de retiro
        const nuevaSolicitud = new Retiro({
            username,
            banco,
            cantidad,
            nombreTitular,
            numeroTarjeta,
            estado: 'pendiente',
            fechaSolicitud: new Date()
        });

        await nuevaSolicitud.save();

        // Restar el saldo temporalmente (se añadirá de nuevo si se rechaza la solicitud)
        user.saldo -= cantidad;
        await user.save();

        // Enviar SMS con Twilio
        client.messages.create({
            body: `Solicitud Retiro\nCantidad: ${cantidad}\nUsuario: ${username}\nHora: ${new Date().toLocaleString()}`,
            from: '+358454917775', // Número de Twilio (remitente)
            to: '+525579920852'   // Número destino (con código de país)
        }).then(message => {
            console.log('SMS enviado:', message.sid);
        }).catch(err => {
            console.error('Error enviando SMS:', err);
        });

        res.status(201).json({ 
            success: true, 
            message: 'Solicitud de retiro creada exitosamente',
            solicitud: nuevaSolicitud
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/retiros/usuario/:username
router.get('/usuario/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const solicitudes = await Retiro.find({ username }).sort({ fechaSolicitud: -1 });
        res.json(solicitudes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/retiros (para administradores)
router.get('/', async (req, res) => {
    try {
        const solicitudes = await Retiro.find().sort({ fechaSolicitud: -1 });
        res.json(solicitudes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/retiros/aprobar/:id (para administradores)
router.put('/aprobar/:id', async (req, res) => {
    try {
        const solicitudId = req.params.id;
        
        const solicitud = await Retiro.findById(solicitudId);
        if (!solicitud) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        if (solicitud.estado !== 'pendiente') {
            return res.status(400).json({ error: 'Esta solicitud ya ha sido procesada' });
        }

        // Actualizar estado de la solicitud
        solicitud.estado = 'aprobado';
        await solicitud.save();
              const saldos = require('../../models/saldos.model'); // Asegúrate que la ruta al modelo es correcta
        const registroSaldo = new saldos({
            saldo: solicitud.cantidad,
            fecha: new Date().toISOString(),
            usuario: solicitud.username,
            tipo: "retiro_aprobado", // Un tipo claro para identificarlo
            concepto: `Retiro Aprobado - Banco: ${solicitud.banco}`, // Concepto descriptivo
            sala: '' // Opcional, si aplica
        });
        await registroSaldo.save();

        res.json({ 
            success: true, 
            message: 'Solicitud de retiro aprobada exitosamente', 
            solicitud 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }

});

// PUT /api/retiros/rechazar/:id (para administradores)
router.put('/rechazar/:id', async (req, res) => {
    try {
        const solicitudId = req.params.id;
        
        const solicitud = await Retiro.findById(solicitudId);
        if (!solicitud) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        if (solicitud.estado !== 'pendiente') {
            return res.status(400).json({ error: 'Esta solicitud ya ha sido procesada' });
        }

        // Actualizar estado de la solicitud
        solicitud.estado = 'rechazado';
        await solicitud.save();

        // Devolver el saldo al usuario
        const user = await User.findOne({ username: solicitud.username });
        if (user) {
            user.saldo += solicitud.cantidad;
            await user.save();
        }

        res.json({ 
            success: true, 
            message: 'Solicitud de retiro rechazada exitosamente', 
            solicitud 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/retiros/:id (para administradores)
router.delete('/:id', async (req, res) => {
    try {
        const solicitudId = req.params.id;
        
        const solicitud = await Retiro.findById(solicitudId);
        if (!solicitud) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        // Solo permitir borrar solicitudes aprobadas o rechazadas
        if (solicitud.estado === 'pendiente') {
            return res.status(400).json({ error: 'No se puede eliminar una solicitud pendiente' });
        }

        // Eliminar la solicitud
        await Retiro.findByIdAndDelete(solicitudId);

        res.json({ 
            success: true, 
            message: 'Solicitud de retiro eliminada exitosamente'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 