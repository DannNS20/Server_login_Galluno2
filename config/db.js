const mongoose = require('mongoose');
require('dotenv').config();

const URI = process.env.MONGOOSE || 'mongodb://localhost:27017/users';

mongoose.connect(URI, {
  // Estas opciones activan el soporte completo de transacciones
  // y mejoran la estabilidad de la conexión en producción.
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('✅ MongoDB conectado');
    // Verificar que las transacciones están disponibles.
    // apuestas.js usa session.startTransaction() para proteger los pagos
    // y eso requiere que MongoDB esté en modo Replica Set.
    const topology = mongoose.connection.client.topology;
    if (topology && topology.description.type === 'ReplicaSetWithPrimary') {
      console.log('✅ Replica Set detectado — transacciones habilitadas');
    } else {
      console.warn('⚠️  Replica Set NO detectado — las transacciones de pago NO funcionarán. Usa MongoDB Atlas o configura --replSet localmente.');
    }
  })
  .catch(err => {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  });
