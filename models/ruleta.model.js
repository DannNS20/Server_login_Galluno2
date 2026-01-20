const mongoose = require('mongoose');

const ruletaSchema = new mongoose.Schema({
  numero: {
    type: Number,
    required: true,
    min: 1,
    max: 14
  },
  precio: {
    type: Number,
    required: true,
    min: 0
  },
  sala: {
    type: String,
    default: 'global'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Para las compras/apuestas
const apuestaSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  numero: {
    type: Number,
    required: true
  },
  monto: {
    type: Number,
    required: true
  },
  sala: {
    type: String,
    required: true
  },
  fecha: {
    type: Date,
    default: Date.now
  }
});

module.exports = {
  Ruleta: mongoose.model('Ruleta', ruletaSchema),
  Apuesta: mongoose.model('Apuesta', apuestaSchema)
};