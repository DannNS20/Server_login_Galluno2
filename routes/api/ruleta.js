const express = require('express');
const router = express.Router();
const { Ruleta, Apuesta } = require('../../models/ruleta.model');

// Establecer precio para un número
router.post('/precios', async (req, res) => {
  try {
    const { numero, precio, sala = 'global' } = req.body;
    if (
      typeof numero !== 'number' || numero < 1 || numero > 14 ||
      typeof precio !== 'number' || precio < 0
    ) {
      return res.status(400).json({ success: false, error: 'Datos inválidos' });
    }
    const existing = await Ruleta.findOneAndUpdate(
      { numero, sala },
      { precio },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: existing });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener todos los precios
router.get('/precios/:sala?', async (req, res) => {
  try {
    const { sala } = req.params;
    const query = sala ? { sala } : {};
    
    const precios = await Ruleta.find(query);
    const result = {};
    
    precios.forEach(item => {
      result[item.numero] = item.precio;
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener compras por sala
router.get('/compras/:sala', async (req, res) => {
  try {
    const { sala } = req.params;
    const compras = await Apuesta.find({ sala }).populate('usuario', 'username');
    
    // Procesar pagos si hay parámetros de ganador
    if (req.query.ganador) {
      const numeroGanador = parseInt(req.query.ganador);
      const userModel = require('../../models/user.model');

      for (const compra of compras) {
        if (compra.numero === numeroGanador && compra.estado === 'activa') {
          const premio = compra.cantidad * 14;
          const comision = premio * 0.2857; // 28.57%
          const pagoUsuario = premio - comision;

          // Pagar al usuario
          await userModel.findOneAndUpdate(
            { username: compra.usuario.username },
            { $inc: { saldo: pagoUsuario } }
          );

          // Pagar comisión a la banca
          await userModel.findOneAndUpdate(
            { username: 'BANCA' },
            { $inc: { saldo: comision } }
          );

          // Marcar apuesta como pagada
          await Apuesta.findByIdAndUpdate(compra._id, { estado: 'pagada' });
        }
      }
    }

    res.json({ success: true, data: compras });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resetear ruleta
router.post('/reset', async (req, res) => {
  try {
    const { sala } = req.body;
    await Ruleta.deleteMany({ sala });
    await Apuesta.deleteMany({ sala });
    res.json({ success: true, message: `Ruleta reseteada para sala ${sala}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restar saldo a un usuario
router.put('/restarSaldo', async (req, res) => {
  try {
    const { username, cantidad } = req.body;
    const userModel = require('../../models/user.model'); // Ajusta la ruta si es necesario
    const user = await userModel.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }
    if (user.saldo < cantidad) {
      return res.status(400).json({ success: false, error: 'Saldo insuficiente' });
    }
    user.saldo -= cantidad;
    await user.save();
    res.json({ success: true, saldo: user.saldo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sumar saldo a un usuario (CON COMISIÓN DEL 28.57% PARA RULETA)
router.put('/sumarSaldo', async (req, res) => {
  try {
    const { username, cantidad, esRuleta = false, ronda, sala } = req.body; // <- Añadimos ronda y sala
    
    const userModel = require('../../models/user.model');
    const user = await userModel.findOne({ username });
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    let montoFinal = cantidad;
    
    if (esRuleta) {
      const comision = cantidad * 0.2857;
      montoFinal = cantidad - comision;

      // Buscar la apuesta correspondiente para verificar
      const apuesta = await Apuesta.findOne({ 
        usuario: user._id, 
        sala, 
        ronda,
        estado: 'activa'
      });

      if (apuesta) {
        // Pagar a la banca (con upsert por si no existe)
        await userModel.findOneAndUpdate(
          { username: 'BANCA' },
          { $inc: { saldo: comision } },
          { upsert: true, new: true }
        );

        // Actualizar apuesta como pagada
        await Apuesta.findByIdAndUpdate(apuesta._id, { 
          estado: 'pagada',
          comisionBanca: comision,
          montoNeto: montoFinal
        });
      }
    }

    user.saldo += montoFinal;
    await user.save();
    
    res.json({ success: true, saldo: user.saldo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
router.post('/set-title', async (req, res) => {
  try {
    const { titulo, sala = 'global' } = req.body;
    
    if (!titulo || typeof titulo !== 'string' || titulo.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Título inválido' });
    }

    // Usar MongoDB para almacenar el título (puedes crear una nueva colección o usar una existente)
    const mongoose = require('mongoose');
    
    // Schema simple para títulos de ruleta
    const tituloRuletaSchema = new mongoose.Schema({
      sala: { type: String, required: true, unique: true },
      titulo: { type: String, required: true },
      updatedAt: { type: Date, default: Date.now }
    });

    const TituloRuleta = mongoose.models.TituloRuleta || mongoose.model('TituloRuleta', tituloRuletaSchema);

    await TituloRuleta.findOneAndUpdate(
      { sala },
      { titulo: titulo.trim(), updatedAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ success: true, message: 'Título actualizado correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener título de ruleta
router.get('/get-title/:sala', async (req, res) => {
  try {
    const { sala } = req.params;
    
    const mongoose = require('mongoose');
    const TituloRuleta = mongoose.models.TituloRuleta;
    
    if (!TituloRuleta) {
      return res.json({ success: true, titulo: '' });
    }

    const tituloDoc = await TituloRuleta.findOne({ sala });
    const titulo = tituloDoc ? tituloDoc.titulo : '';

    res.json({ success: true, titulo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
module.exports = router;