const mongoose = require('mongoose');

const ReceiptLockSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  lastRun: { type: Date, required: true },
});

module.exports = mongoose.model('ReceiptLock', ReceiptLockSchema);