const {model, Schema} = require("mongoose");

const saldosSchema = new Schema({
    saldo: Number,
    fecha: String,
    usuario: String,
    concepto: { type: String, default: "" },
    tipo: { type: String, default: "" },
    sala: { type: String}
});

module.exports = model("saldos", saldosSchema); 