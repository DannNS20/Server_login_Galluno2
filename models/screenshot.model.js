const {model, Schema} = require("mongoose");

const screenshotSchema = new Schema({
  usuario: {
    type: String,
    required: true
  },
  sala: {
    type: String,
    required: true
  },
  // cambiado a Number para consistencia con las búsquedas por ronda
  ronda: {
    type: Number,
    required: true
  },
  saldo: {
    type: Number,
    required: true
  },
  momento: {
    type: String,
    enum: ['inicio', 'final'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports =  model('Screenshot', screenshotSchema);
