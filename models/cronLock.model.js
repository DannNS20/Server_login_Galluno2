const mongoose = require('mongoose');

const cronLockSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    lastRun: { type: Date, required: true },
    status: { type: String, enum: ['LOCKED', 'IDLE'], default: 'IDLE' },
    replicaId: { type: String } // Útil para debugging
});

// Índice compuesto para mejorar el rendimiento de las consultas de lock
cronLockSchema.index({ name: 1, lastRun: 1 });

// TTL Index: Liberar locks automáticamente después de 30 minutos (seguridad adicional)
cronLockSchema.index({ lastRun: 1 }, { expireAfterSeconds: 1800 });

module.exports = mongoose.model('CronLock', cronLockSchema);
