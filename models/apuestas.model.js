const { model, Schema } = require("mongoose");

const apuestaSchema = new Schema({
  username: String,
  rojo: String,
  verde: String,
  cantidad: Number,
  sala: String,
  fecha: Date,
  ronda: { type: Number, default: 0 },
  estado: { type: String, default: 'en_espera' }, // Nuevo campo para el estado de la apuesta
});

module.exports = model("apuesta", apuestaSchema);