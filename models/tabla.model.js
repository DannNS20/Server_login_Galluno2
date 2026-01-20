const mongoose = require('mongoose');

const TablaSchema = new mongoose.Schema({
  title: { type: String, default: 'TABLA DE PUNTOS' },
  tablaData: { type: Array, default: [] },
  rows: { type: Number, default: 9 },
  cols: { type: Number, default: 9 },
  cellColors: { type: Object, default: {} },
  cellMarks: { type: Object, default: {} }, // <-- almacenar marcas X/T
  palenqueName: { type: String, default: 'PALENQUE LEÓN' },
  entradaAmount: { type: String, default: '$50,000.00' },
  partyNames: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Tabla', TablaSchema);