const mongoose = require('mongoose');
const { Schema } = mongoose;

const settingsSchema = new Schema({
    streamTitle: { type: String, default: 'QUINIELAS GALLISTICAS' },
    maintenanceMode: { type: Boolean, default: false }
}, {
    timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);
