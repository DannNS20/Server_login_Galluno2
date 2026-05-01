const mongoose = require('mongoose');

const rondaSchema = new mongoose.Schema({
  round: { type: Number, required: true },
  winner: { type: String, enum: ['rojo', 'verde', 'empate'], required: true }
}, { _id: false });

const historialRondasSchema = new mongoose.Schema({
  sala: { type: String, required: true, unique: true, index: true },
  rondas: { type: [rondaSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('HistorialRondas', historialRondasSchema);
