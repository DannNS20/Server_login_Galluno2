const {model, Schema} = require("mongoose");

const paymentSchema = new Schema({
    id: String,
    beneficiario: String,
    clabe: String,
    numeroCuenta: String,
    banco: String,
    concepto: { type: String, default: "" }
});

module.exports = model("payment", paymentSchema); 