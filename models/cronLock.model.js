const mongoose = require('mongoose');

const cronLockSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    lastRun: { type: Date, required: true },
    status: { type: String, enum: ['LOCKED', 'IDLE'], default: 'IDLE' },
    replicaId: { type: String } // Útil para debugging
});

// TTL Index opcional: Si el lock se queda pillado, liberarlo después de X tiempo (ej. 30 min)
// cronLockSchema.index({ lastRun: 1 }, { expireAfterSeconds: 1800 });

module.exports = mongoose.model('CronLock', cronLockSchema);
