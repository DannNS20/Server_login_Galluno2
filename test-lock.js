/**
 * Script de prueba para verificar que el lock distribuido funciona correctamente
 * Simula múltiples réplicas intentando adquirir el lock simultáneamente
 * 
 * Uso: node test-lock.js
 */

require('dotenv').config();
require('./config/db');
const CronLock = require('./models/cronLock.model');

/**
 * Simula la función acquireLock del email.service.js
 */
async function acquireLock(lockName, replicaId) {
    const LOCK_DURATION_MS = 14 * 60 * 1000; // ~14 min
    const now = new Date();
    const threshold = new Date(now.getTime() - LOCK_DURATION_MS);

    try {
        const result = await CronLock.findOneAndUpdate(
            {
                name: lockName,
                $or: [
                    { lastRun: { $lt: threshold } },
                    { lastRun: { $exists: false } }
                ]
            },
            {
                $set: {
                    lastRun: now,
                    status: 'LOCKED',
                    replicaId: replicaId
                }
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        if (result) {
            console.log(`✅ [${replicaId}] Lock ADQUIRIDO exitosamente`);
            return true;
        }

        console.log(`❌ [${replicaId}] Lock NO adquirido (otra réplica lo tiene)`);
        return false;

    } catch (error) {
        if (error.code === 11000) {
            console.log(`❌ [${replicaId}] Lock NO adquirido (error de duplicado)`);
            return false;
        }
        console.error(`⚠️  [${replicaId}] Error:`, error.message);
        throw error;
    }
}

/**
 * Simula una réplica intentando adquirir el lock
 */
async function simulateReplica(replicaId, delay = 0) {
    return new Promise((resolve) => {
        setTimeout(async () => {
            console.log(`🔄 [${replicaId}] Intentando adquirir lock...`);
            const acquired = await acquireLock('test-lock', replicaId);
            resolve({ replicaId, acquired });
        }, delay);
    });
}

/**
 * Test principal
 */
async function runTest() {
    console.log('\n=================================================');
    console.log('🧪 PRUEBA DE LOCK DISTRIBUIDO');
    console.log('=================================================\n');

    // Limpiar locks de prueba anteriores
    console.log('🧹 Limpiando locks de prueba anteriores...');
    await CronLock.deleteMany({ name: 'test-lock' });
    console.log('✓ Limpieza completada\n');

    // TEST 1: Múltiples réplicas intentando adquirir el lock SIMULTÁNEAMENTE
    console.log('📌 TEST 1: Simulando 3 réplicas intentando adquirir el lock al MISMO TIEMPO');
    console.log('Resultado esperado: Solo 1 réplica debe adquirir el lock\n');

    const promises = [
        simulateReplica('REPLICA-1', 0),
        simulateReplica('REPLICA-2', 0),
        simulateReplica('REPLICA-3', 0)
    ];

    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.acquired).length;
    const failCount = results.filter(r => !r.acquired).length;

    console.log('\n📊 RESULTADOS TEST 1:');
    console.log(`   ✅ Locks adquiridos: ${successCount}`);
    console.log(`   ❌ Locks rechazados: ${failCount}`);

    if (successCount === 1 && failCount === 2) {
        console.log('   🎉 ¡TEST 1 PASADO! Solo una réplica adquirió el lock\n');
    } else {
        console.log('   ⚠️  TEST 1 FALLÓ - Se esperaba 1 lock adquirido y 2 rechazados\n');
    }

    // Verificar estado en la base de datos
    const lockDoc = await CronLock.findOne({ name: 'test-lock' });
    console.log('📄 Estado del lock en MongoDB:');
    console.log(`   Nombre: ${lockDoc.name}`);
    console.log(`   Réplica que lo adquirió: ${lockDoc.replicaId}`);
    console.log(`   Última ejecución: ${lockDoc.lastRun}`);
    console.log(`   Estado: ${lockDoc.status}\n`);

    // TEST 2: Intentar adquirir el lock cuando ya está activo
    console.log('📌 TEST 2: Intentando adquirir un lock que ya está activo');
    console.log('Resultado esperado: Debe ser rechazado\n');

    const result2 = await simulateReplica('REPLICA-4', 0);

    console.log('\n📊 RESULTADOS TEST 2:');
    if (!result2.acquired) {
        console.log('   🎉 ¡TEST 2 PASADO! El lock activo fue respetado\n');
    } else {
        console.log('   ⚠️  TEST 2 FALLÓ - No debería haber adquirido el lock\n');
    }

    // TEST 3: Adquirir lock después de que expire
    console.log('📌 TEST 3: Simulando expiración del lock (modificando lastRun)');
    console.log('Resultado esperado: Debe poder adquirir el lock\n');

    // Modificar el lock para que parezca viejo (más de 14 minutos)
    const oldDate = new Date(Date.now() - 15 * 60 * 1000); // 15 minutos atrás
    await CronLock.updateOne(
        { name: 'test-lock' },
        { $set: { lastRun: oldDate } }
    );

    const result3 = await simulateReplica('REPLICA-5', 0);

    console.log('\n📊 RESULTADOS TEST 3:');
    if (result3.acquired) {
        console.log('   🎉 ¡TEST 3 PASADO! El lock expirado fue adquirido correctamente\n');
    } else {
        console.log('   ⚠️  TEST 3 FALLÓ - Debería haber adquirido el lock expirado\n');
    }

    // Limpiar
    console.log('🧹 Limpiando locks de prueba...');
    await CronLock.deleteMany({ name: 'test-lock' });
    console.log('✓ Limpieza completada\n');

    console.log('=================================================');
    console.log('✅ PRUEBAS COMPLETADAS');
    console.log('=================================================\n');

    process.exit(0);
}

// Ejecutar test
runTest().catch(error => {
    console.error('❌ Error en las pruebas:', error);
    process.exit(1);
});
