const mongoose = require('mongoose');

if (!process.env.MONGOOSE) {
  throw new Error('❌ MONGOOSE no está definido');
}

mongoose.connect(process.env.MONGOOSE, {
  // Estas opciones activan el soporte completo de transacciones
  // y mejoran la estabilidad de la conexión en producción
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('✅ MongoDB conectado');
    // Verificar que las transacciones están disponibles
    const topology = mongoose.connection.client.topology;
    if (topology && topology.description.type === 'ReplicaSetWithPrimary') {
      console.log('✅ Replica Set detectado — transacciones habilitadas');
    } else {
      console.warn('⚠️  Replica Set NO detectado — las transacciones no funcionarán');
    }
  })
  .catch(err => {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  });
