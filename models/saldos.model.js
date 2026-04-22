const {model, Schema} = require("mongoose");

const saldosSchema = new Schema({
    saldo: Number,
    fecha: String,
    usuario: String,
    concepto: { type: String, default: "" },
    tipo: { type: String, default: "" },
    sala: { type: String, default: "" },
    ronda: { type: Number, default: null },
    saldo_antes:   { type: Number, default: null },
    saldo_despues: { type: Number, default: null },
});

module.exports = model("saldos", saldosSchema);