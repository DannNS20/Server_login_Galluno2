const router = require('express').Router();
const { Venta, Rifa } = require('../../models/rifa.model');
const userModel = require('../../models/user.model');

// Helper para redondear montos
const eliminarCentavos = monto => Math.floor(monto);

// Obtener todas las rifas
router.get('/obtenerTodasLasRifas', async (req, res) => {
  try {
    const rifas = await Rifa.find();
    res.json(rifas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener rifas por sala
router.get('/obtenerRifasBySala/:room', async (req, res) => {
  try {
    const rifas = await Rifa.find({ 
      $or: [
        { room: req.params.room },
        { room: 'ALL' }
      ]
    }).sort({ numeroRifa: -1 });
    res.json(rifas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener estado de rifa específica
router.get('/estadoRifa/:room/:rifa', async (req, res) => {
  try {
    const rifa = await Rifa.findOne({ 
      numeroRifa: req.params.rifa,
      $or: [
        { room: req.params.room },
        { room: 'ALL' }
      ]
    });
    res.json(rifa || { error: 'Rifa no encontrada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva rifa
router.post('/crearRifa', async (req, res) => {
  try {
    const { numeroRifa, totalNumeros, precioNumero, room = 'ALL' } = req.body;

    // Validaciones
    if (!numeroRifa || !totalNumeros || !precioNumero) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    if (precioNumero < 2) {
      return res.status(400).json({ error: 'El precio mínimo por número es 2' });
    }

    if (totalNumeros < 1 || totalNumeros > 700) {
      return res.status(400).json({ error: 'La cantidad de números debe estar entre 1 y 700' });
    }

    const numerosDisponibles = Array.from({ length: totalNumeros }, (_, i) => i + 1);

    const rifa = new Rifa({
      numeroRifa,
      totalNumeros,
      precioNumero,
      room,
      numerosDisponibles,
      estadoVentas: true
    });

    await rifa.save();
    res.status(201).json(rifa);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Comprar números
router.post('/comprarNumeros', async (req, res) => {
  try {
    const { username, numeros, room, rifa } = req.body;

    // Validaciones básicas
    if (!username || !numeros || !room || !rifa) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    // Buscar rifa
    const rifaDoc = await Rifa.findOne({ 
      numeroRifa: rifa,
      $or: [
        { room },
        { room: 'ALL' }
      ]
    });

    if (!rifaDoc) {
      return res.status(404).json({ error: 'Rifa no encontrada' });
    }

    // Comprar números
    const resultado = await rifaDoc.comprarNumeros(username, numeros, rifaDoc.precioNumero);

    // Actualizar saldo del usuario
    await userModel.findOneAndUpdate(
      { username },
      { $inc: { saldo: -resultado.venta.cantidad } }
    );

    res.json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Cerrar ventas
router.put('/cerrarVentas/:rifaId', async (req, res) => {
  try {
    const rifa = await Rifa.findOne({numeroRifa: req.params.rifaId});
    if (!rifa) {
      return res.status(404).json({ error: 'Rifa no encontrada' });
    }

    await rifa.cerrarVentas();
    res.json(rifa);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Seleccionar ganador
router.put('/registrarGanador/:rifaId', async (req, res) => {
  try {
    const { numeroGanador } = req.body;
    // ANTES: const rifa = await Rifa.findById(req.params.rifaId);
    // DESPUÉS:
    const rifa = await Rifa.findOne({ numeroRifa: req.params.rifaId });

    if (!rifa) {
      return res.status(404).json({ error: 'Rifa no encontrada' });
    }
    await rifa.seleccionarGanador(numeroGanador);
    await userModel.findOneAndUpdate({ username: rifa.ganador.username }, { $inc: { saldo: eliminarCentavos(rifa.premio) } });
    await userModel.findOneAndUpdate({ username: 'BANCA' }, { $inc: { saldo: eliminarCentavos(rifa.banca) } });
    res.json(rifa);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
// Obtener ventas por sala y rifa
router.get('/obtenerVentasBySalaRifa/:room/:rifa', async (req, res) => {
  try {
    const ventas = await Venta.find({ 
      room: req.params.room, 
      rifa: req.params.rifa 
    }).sort({ date: -1 });
    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Borrar venta
router.delete('/eliminar/:rifaId', async (req, res) => {
  try {
    const resultado = await Rifa.deleteOne({ numeroRifa: req.params.rifaId });
    
    if (resultado.deletedCount === 0) {
      return res.status(404).json({ error: 'No se encontró una rifa con ese número para eliminar' });
    }
     res.status(200).json({ success: true, message: 'Rifa eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.put('/abrirVentas/:rifaId', async (req, res) => {
  try {
    const rifa = await Rifa.findOneAndUpdate(
      { numeroRifa: req.params.rifaId },
      { estadoVentas: true },
      { new: true } // Devuelve el documento actualizado
    );
    if (!rifa) {
      return res.status(404).json({ error: 'Rifa no encontrada' });
    }
    res.json(rifa);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
// NUEVO: Endpoint para 'iniciar' una rifa (similar a crear)
router.post('/:rifaId/iniciar', async (req, res) => {
    // Esta ruta es esencialmente un alias de 'crearRifa' pero usando el parámetro de la URL.
    // La lógica de creación real se maneja en el WebSocket, pero se añade para evitar errores 404.
    try {
        const existe = await Rifa.findOne({ numeroRifa: req.params.rifaId });
        if (existe) {
            return res.status(409).json({ message: 'Esta rifa ya existe.', rifa: existe });
        }
        // Si no existe, podrías crearla aquí o simplemente devolver un éxito conceptual.
        res.status(200).json({ message: `Petición para iniciar rifa ${req.params.rifaId} recibida.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;