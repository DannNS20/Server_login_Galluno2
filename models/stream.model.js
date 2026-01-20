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
}, {
    timestamps: true // Mantiene createdAt y updatedAt
});

module.exports = mongoose.model('Stream', streamSchema);