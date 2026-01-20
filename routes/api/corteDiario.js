const router = require('express').Router();
const User = require('../../models/user.model');
const Retiro = require('../../models/retiro.model');
const Recipe = require('../../models/recipe.model');
const Stream = require('../../models/stream.model');
const CorteDiario = require('../../models/corteDiario.model');
/**
 * GET /api/corte-diario/:stream
 * Devuelve el resumen del corte diario para un stream específico.
 * Si no usas streams en retiros/recibos, puedes ignorar el filtro por stream.
 */
router.get('/:stream', async (req, res) => {
  try {
    const { stream } = req.params;

    // 1. Usuarios (excluyendo BANCA)
    const users = await User.find({});
    const saldoGlobal = users.reduce((acc, u) => u.username !== 'BANCA' ? acc + (u.saldo || 0) : acc, 0);
    const usuariosConSaldo = users.filter(u => u.username !== 'BANCA' && (u.saldo || 0) > 0).length;

    // 2. Retiros pendientes (puedes quitar el filtro por stream si no lo usas en retiros)
    const retiros = await Retiro.find({ estado: 'pendiente' });
    const cantidadRetiros = retiros.length;
    const montoRetiros = retiros.reduce((acc, r) => acc + (Number(r.cantidad) || 0), 0);

    // 3. Recibos pendientes (puedes quitar el filtro por stream si no lo usas en recipes)
    const recibos = await Recipe.find({ $or: [{ estado: 'pendiente' }, { estado: { $exists: false } }] });
    const recibosPendientes = recibos.length;
    const montoRecibosPendientes = recibos.reduce((acc, r) => acc + (Number(r.monto) || 0), 0);

   
    res.json({
      saldoGlobal,
      cantidadRetiros,
      montoRetiros,
      usuariosConSaldo,
      recibosPendientes,
      montoRecibosPendientes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.post('/guardar', async (req, res) => {
  try {
    const { stream, datos } = req.body;
    if (!stream || !datos) {
      return res.status(400).json({ error: 'stream y datos son requeridos' });
    }
    const corte = new CorteDiario({
      stream,
      ...datos
    });
    await corte.save();
    res.json({ success: true, corte });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get('/historial/:stream', async (req, res) => {
  try {
    const { stream } = req.params;
    const cortes = await CorteDiario.find({ stream }).sort({ fecha: -1 });
    res.json(cortes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
module.exports = router;