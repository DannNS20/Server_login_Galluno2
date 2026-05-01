const mongoose = require('mongoose');

const contadorEstadoSchema = new mongoose.Schema({
  sala: { type: String, required: true, unique: true, index: true },
  ronda: { type: Number, default: 0 },
  contadorRestante: { type: Number, default: 0 },
  timestampCierreApuestas: { type: Number, default: null },
  estadoApuesta: { type: Boolean, default: true } // true = abiertas, false = cerradas
}, { timestamps: true });

module.exports = mongoose.model('ContadorEstado', contadorEstadoSchema);
