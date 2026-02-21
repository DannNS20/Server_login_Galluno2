const mongoose = require('mongoose');
const { Schema } = mongoose;

const streamSchema = new Schema({
    id: {
        type: String, // CAMBIAR DE Number A String
        required: true,
        unique: true
    },
    titulo: { type: String },
    clave: { type: String },
    image: { type: String },
    esVIP: { type: Boolean },
    visible: { type: Boolean, default: false }, // Por defecto, un stream no es visible
    snapshot: {
        saldoGlobal: Number,
        retiros: Number,
        total: Number,
        startedAt: Date,
        usuarios: [{
            username: String,
            saldoInicial: Number
        }]
    },
    finalSnapshot: {
        saldoGlobal: Number,
        retiros: Number,
        depositos: Number,
        saldoManual: Number,
        restaManual: Number,
        cazado: Number,
        total: Number,
        endedAt: Date,
        usuarios: [{
            username: String,
            saldoInicial: Number,
            saldoFinal: Number // Additional metric if needed
        }]
    },
}, {
    timestamps: true // Mantiene createdAt y updatedAt
});

module.exports = mongoose.model('Stream', streamSchema);