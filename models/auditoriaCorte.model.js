const mongoose = require('mongoose');

const auditoriaCorteSchema = new mongoose.Schema({
  fechaCorte: { type: Date, required: true },
  creadoPor: { type: String, default: 'admin' },
  nota: { type: String, default: '' }
}, { timestamps: true });

// Solo habrá un documento (singleton)
module.exports = mongoose.model('AuditoriaCorte', auditoriaCorteSchema);