const {model, Schema} = require("mongoose");

const retiroSchema = new Schema({
    username: String,
    banco: String,
    cantidad: { type: Number, required: true },
    nombreTitular: String,
    numeroTarjeta: String, // Puede ser número de tarjeta o CLABE
    estado: { type: String, default: 'pendiente' }, // pendiente, aprobado, rechazado
    fechaSolicitud: { type: Date, default: Date.now }
});

module.exports = model("retiro", retiroSchema); 