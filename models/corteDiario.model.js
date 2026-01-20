const mongoose = require('mongoose');

const CorteDiarioSchema = new mongoose.Schema({
  stream: { type: String, required: true },
  fecha: { type: Date, default: Date.now },
  saldoGlobal: Number,
  cantidadRetiros: Number,
  montoRetiros: Number,
  usuariosConSaldo: Number,
  recibosPendientes: Number,
  montoRecibosPendientes: Number
});

module.exports = mongoose.model('CorteDiario', CorteDiarioSchema);