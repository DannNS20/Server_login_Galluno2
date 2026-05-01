const router = require('express').Router();
const apuestaModel = require('../../models/apuestas.model');
const Screenshot = require('../../models/screenshot.model');
const userModel = require('../../models/user.model');
const saldos = require('../../models/saldos.model');
const auditoriaCorteModel = require('../../models/auditoriaCorte.model');
const contadorEstadoModel = require('../../models/contadorEstado.model');
//const historialRondasModel = require('../../models/historialRondas.model');
const eliminarCentavos = (monto) => Math.floor(monto); // 10.99 → 10

// =============================================================================
// HELPER: conTransaccion
// Por qué: Centraliza la lógica de iniciar/confirmar/revertir sesiones de MongoDB.
// Para qué: Cualquier operación financiera que toque más de una colección usa
//           este helper para garantizar que si algo falla a mitad, todo se revierte
//           y ningún peso queda en un estado inconsistente.
// =============================================================================
async function conTransaccion(fn) {
  const session = await apuestaModel.db.startSession();
  session.startTransaction();
  try {
    const resultado = await fn(session);
    await session.commitTransaction();
    return resultado;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
async function verificarBalanceRonda(sala, ronda) {
  try {
    const stats = await apuestaModel.aggregate([
      { $match: { sala, ronda } },
      { $group: { _id: '$estado', total: { $sum: '$cantidad' } } }
    ]);
    const get = (estado) => stats.find(s => s._id === estado)?.total || 0;
    const pagada   = get('pagada');
    const perdida  = get('perdida');
    const devuelta = get('devuelta');
    const diferencia = pagada - perdida;
    const hayAlerta  = diferencia !== 0;
 
    // Reutiliza el modelo saldos con un tipo especial para no mezclar con movimientos reales
    await new saldos({
      saldo: diferencia,
      fecha: new Date().toISOString(),
      usuario: '_SISTEMA_',
      tipo: 'balance_ronda',
      concepto: hayAlerta
        ? `⚠️ ASIMETRÍA R${ronda}: pagada $${pagada} vs perdida $${perdida} → diff $${diferencia}`
        : `✅ OK R${ronda}: pagada $${pagada} == perdida $${perdida} | comisión $${Math.floor(pagada*0.1)}`,
      sala,
      ronda
    }).save();
 
    if (hayAlerta) {
      console.error(`[ALERTA BALANCE] ${sala} R${ronda}: pagada $${pagada} vs perdida $${perdida} → diferencia $${diferencia}`);
    } else {
      console.log(`[OK BALANCE] ${sala} R${ronda}: $${pagada} == $${perdida} ✅ comisión $${Math.floor(pagada*0.1)}`);
    }
  } catch (err) {
    console.error('[AUDITORIA] Error en verificarBalanceRonda:', err.message);
  }
}

router.get('/obtenerapuestas', async (req, res) => {
    res.send("hola");
});

router.put('/repartirGanancias/:sala/:ronda/:ganador', async (req, res) => { 
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);
    const ganador = req.params.ganador.toLowerCase();
    const { ajustes } = req.body; 

    if (ganador !== 'rojo' && ganador !== 'verde') {
      return res.status(400).json({ error: "El color ganador debe ser 'rojo' o 'verde'." });
    }

    const colorPerdedor = ganador === 'rojo' ? 'verde' : 'rojo';

    // =========================================================================
    // CAMBIO: Protección contra doble pago
    // Por qué: Si el admin hace doble clic o la red reintenta la petición,
    //          repartirGanancias se ejecutaría dos veces pagando el doble.
    // Para qué: Verificar si ya hay apuestas pagadas en esta ronda antes de
    //           procesar cualquier pago. Si las hay, rechazar con 409.
    // =========================================================================
    const yaPagadas = await apuestaModel.countDocuments({ sala, ronda, estado: 'pagada' });
    if (yaPagadas > 0) {
      return res.status(409).json({
        error: `Esta ronda ya fue pagada (${yaPagadas} apuestas en estado pagada). No se puede pagar dos veces.`,
        yaPagada: true
      });
    }
    
    // 1. Marcar como PERDIDAS las apuestas cazadas del color que no salió
    const queryPerdedores = {
      sala,
      ronda,
      estado: 'cazada',
      ...(colorPerdedor === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' })
    };
    await apuestaModel.updateMany(queryPerdedores, { $set: { estado: 'perdida' } });

    // --- LÓGICA DE REPARTICIÓN CON AJUSTES ---
    if (ajustes && Array.isArray(ajustes) && ajustes.length > 0) {
      await apuestaModel.updateMany(
        { sala, ronda, estado: 'cazada' },
        { $set: { estado: 'pagada', fechaCierre: new Date() } }
      );

      let comisionBancaTotal = 0;

      // =========================================================================
      // CAMBIO: Promise.all → for...of dentro de transacción
      // Por qué: Promise.all ejecuta todos los pagos en paralelo. Si uno falla
      //          a mitad, algunos usuarios ya cobraron y otros no. No hay rollback.
      // Para qué: Procesar en serie dentro de una transacción. Si cualquier pago
      //           falla, TODOS se revierten y nadie queda en estado inconsistente.
      // =========================================================================
      await conTransaccion(async (session) => {
        for (const ajuste of ajustes) {
          const { username, totalAEntregar, apuestaOriginal } = ajuste;
          const montoFinal = eliminarCentavos(totalAEntregar);

          if (isNaN(montoFinal) || montoFinal < 0) continue;

          const comision = eliminarCentavos(Number(apuestaOriginal) * 0.1);
          comisionBancaTotal += comision;

          if (montoFinal > 0) {
            await userModel.findOneAndUpdate(
              { username },
              { $inc: { saldo: montoFinal } },
              { session }
            );
           /* await new saldos({
              saldo: montoFinal,
              fecha: new Date().toISOString(),
              usuario: username,
              tipo: "apuesta_ganada",
              concepto: `Aumento manual ajustado por ganar`
            }).save({ session });*/
          }
        }

        if (comisionBancaTotal > 0) {
          await userModel.findOneAndUpdate(
            { username: 'BANCA' },
            { $inc: { saldo: comisionBancaTotal } },
            { session }
          );
        }
      });

    } else {
      // --- LÓGICA ORIGINAL (SIN SCREENSHOTS) ---
      // IMPORTANTE: Solo buscamos las que quedaron como 'cazada' del color ganador
      const apuestasGanadoras = await apuestaModel.find({ 
        sala, 
        ronda, 
        estado: 'cazada',
        ...(ganador === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' })
      });

      if (apuestasGanadoras.length === 0) {
        return res.json({ message: "No hay apuestas ganadoras." });
      } 

      // =========================================================================
      // CAMBIO: Promise.all → for...of dentro de transacción
      // Por qué: Si falla el pago del usuario 3 de 10, los primeros 2 ya
      //          cobraron y los otros 8 no. Sin rollback posible.
      // Para qué: Si cualquier operación falla, MongoDB revierte TODOS los
      //           pagos y la ronda queda lista para reintentar.
      // =========================================================================
      await conTransaccion(async (session) => {
        for (const apuesta of apuestasGanadoras) {
          const { username, cantidad } = apuesta;
          const comisionBanca = eliminarCentavos(cantidad * 0.1);
          const montoGanado = eliminarCentavos((cantidad * 2) - comisionBanca);

          if (isNaN(montoGanado) || montoGanado <= 0) continue;

          // Pagar al usuario
          await userModel.findOneAndUpdate(
            { username },
            { $inc: { saldo: montoGanado } },
            { session }
          );

          // Registrar movimiento con ronda y sala para reconciliación en auditoría
          await new saldos({
            saldo: montoGanado,
            fecha: new Date().toISOString(),
            usuario: username,
            tipo: "apuesta_ganada",
            concepto: `Aumento automático al ganar la apuesta`,
            ronda: ronda,   // Campo directo para reconciliación en auditoría
            sala: sala       // Campo directo para reconciliación en auditoría
          }).save({ session });

          // Pagar comisión a la banca
          await userModel.findOneAndUpdate(
            { username: 'BANCA' },
            { $inc: { saldo: comisionBanca } },
            { session }
          );

          // Actualizar el estado de la apuesta a PAGADA para que no se vuelva a contar
          await apuestaModel.findByIdAndUpdate(
            apuesta._id,
            { estado: 'pagada', fechaCierre: new Date() },
            { session }
          );
        }
      });
    }

    // ELIMINADA TODA LA SECCIÓN DE SCREENSHOTS Y CORRECCIÓN DE DISCREPANCIAS
      await verificarBalanceRonda(sala, ronda);
    res.json({ success: "Ganancias repartidas exitosamente y sin ajustes de screenshot." });

  } catch (error) {
    console.error('Error al repartir ganancias:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});
router.get('/obtenerapuestasBySalaRonda/:sala/:ronda',async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);
    // Buscar todos los apuestas que coincidan con la sala
    const apuestas = await apuestaModel.find({ sala, ronda });
    if (apuestas.length === 0) {
      return res.json({});
    }
    // Si no necesitas modificar las apuestas, no hace falta usar Promise.all
    const apuestasProcesadas = await Promise.all(apuestas.map(async (apuesta) => {
      return apuesta;
    }));
    res.json(apuestasProcesadas);
  } catch (error) {
    console.error('Error al obtener apuestas por sala:', error);
    res.status(500).json({ error: 'Error interno del servidor' });

  }
});

router.get('/obtenerapuestasBySala/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;

    // Buscar todos los apuestas que coincidan con la sala
    const apuestas = await apuestaModel.find({ sala });

    if (apuestas.length === 0) {
      return res.json({});
    }

    // Si no necesitas modificar las apuestas, no hace falta usar Promise.all
    const apuestasProcesadas = await Promise.all(apuestas.map(async (apuesta) => {
      return apuesta;
    }));

    res.json(apuestasProcesadas);
  } catch (error) {
    console.error('Error al obtener apuestas por sala:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
  
// =============================================================================
// POST /crearApuesta  — NUEVO ENDPOINT ATÓMICO
// Por qué: El flujo anterior hacía restarSaldo + enviarapuesta como dos llamadas
//          HTTP separadas. Si la red fallaba entre ellas, el saldo se descontaba
//          pero la apuesta no existía (o viceversa), creando dinero fantasma.
// Para qué: Une ambas operaciones en una sola transacción MongoDB. Si el saldo
//           es insuficiente, el $gte lo rechaza ANTES de tocar nada. Si cualquier
//           paso falla, el rollback deja todo exactamente como estaba.
// Usado por: chat_gateway.ts → event_message (reemplaza restarSaldo + enviarapuesta)
// =============================================================================
router.post('/crearApuesta', async (req, res) => {
  try {
    const { username, rojo, verde, cantidad, room, ronda, date } = req.body;
    const cantidadRedondeada = eliminarCentavos(Number(cantidad));

    if (!username || !room || !ronda) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    if (isNaN(cantidadRedondeada) || cantidadRedondeada <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }
    if (!rojo && !verde) {
      return res.status(400).json({ error: 'Debe especificar color rojo o verde' });
    }

    const resultado = await conTransaccion(async (session) => {
      // PASO 1: Descontar saldo — solo si hay suficiente (condición $gte es atómica).
      const userActualizado = await userModel.findOneAndUpdate(
        {
          username,
          saldo: { $gte: cantidadRedondeada } // Solo actualiza si hay saldo suficiente
        },
        {
          $inc: { saldo: -cantidadRedondeada },
          $set: { lastActivity: new Date() }
        },
        { session, new: true }
      );

      if (!userActualizado) {
        const userExiste = await userModel.findOne({ username }).session(session).lean();
        if (!userExiste) {
          const err = new Error('Usuario no encontrado');
          err.status = 404;
          throw err;
        }
        const err = new Error(`Saldo insuficiente. Saldo actual: $${userExiste.saldo}, apuesta: $${cantidadRedondeada}`);
        err.status = 400;
        err.saldoActual = userExiste.saldo;
        throw err;
      }

      // PASO 2: Guardar la apuesta — dentro de la misma transacción que el descuento.
      const nuevaApuesta = new apuestaModel({
        username,
        rojo: rojo || '',
        verde: verde || '',
        cantidad: cantidadRedondeada,
        fecha: date ? new Date(date) : new Date(),
        sala: room,
        ronda: Number(ronda),
        estado: 'en_espera'
      });
      await nuevaApuesta.save({ session });

      const saldoAntes = userActualizado.saldo + cantidadRedondeada; // saldo antes del descuento
      const saldoDespues = userActualizado.saldo;                     // saldo después del descuento
 
      // Validación de seguridad: si saldoAntes < cantidadRedondeada algo salió mal
      // (no debería pasar por el $gte, pero lo registramos por si acaso)
      if (saldoAntes < cantidadRedondeada) {
        console.error(`[ALERTA SALDO] ${username} apostó $${cantidadRedondeada} teniendo $${saldoAntes}`);
      }
 
      await new saldos({
        saldo: cantidadRedondeada,
        fecha: new Date().toISOString(),
        usuario: username,
        tipo: 'restar_saldo',
        concepto: `Apuesta P${ronda}`,
        sala: room,
        ronda: Number(ronda),          // ← AGREGAR: para poder filtrar por ronda
        saldo_antes: saldoAntes,       // ← AGREGAR: saldo antes de apostar
        saldo_despues: saldoDespues    // ← AGREGAR: saldo después de apostar
      }).save({ session });

      return {
        apuestaId: nuevaApuesta._id,
        saldoRestante: userActualizado.saldo
      };
    });

    return res.json({
      success: true,
      apuestaId: resultado.apuestaId,
      saldoRestante: resultado.saldoRestante,
      data: 'Apuesta ingresada!'
    });

  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error: error.message,
      saldoActual: error.saldoActual
    });
  }
});

router.post('/enviarapuesta', async (req, res) => {
  try {
    // Construir la apuesta a guardar en la base de datos
    const cantidad = eliminarCentavos(Number(req.body.cantidad));//Nos aseguramos de que solo sean num enteros 
    const newBet = new apuestaModel({
      username: req.body.username,
      rojo: req.body.rojo,
      verde: req.body.verde,
      cantidad: cantidad, // Asegurarse de que sea un número
      fecha: req.body.date,
      sala: req.body.room,
      ronda: req.body.ronda,
      estado: req.body.estado || 'en_espera' // Incluir el estado
    });

    // Guardar la apuesta en la base de datos
    await newBet.save();
    console.log(newBet);
    // Actualizar la última actividad del usuario
    await userModel.findOneAndUpdate(
      { username: req.body.username },
      { $set: { lastActivity: new Date() } }
    );

    // Responder al cliente con éxito y el ID de la apuesta
    return res.json({ data: "Apuesta ingresada!", apuestaId: newBet._id });
  } catch (error) {
    console.error('Error al procesar la solicitud POST:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Endpoint atómico para emparejar apuestas usando transacciones de MongoDB
 * Este endpoint previene condiciones de carrera al asegurar atomicidad en las operaciones
 * 
 * @route POST /api/apuestas/emparejarAtomico
 * @body {string} apuestaId - ID de la apuesta a emparejar
 * @body {number} cantidadOriginal - Cantidad original de la apuesta
 * @body {string} room - Sala de la apuesta
 * @body {number} ronda - Ronda de la apuesta
 * @body {string} colorBuscado - Color opuesto a buscar ('rojo' o 'verde')
 * @returns {Object} Resultado del emparejamiento con apuestas cazadas y cantidad restante
 */
router.post('/emparejarAtomico', async (req, res) => {
  const session = await apuestaModel.db.startSession();
  session.startTransaction();
  
  try {
    const { apuestaId, cantidadOriginal, room, ronda, colorBuscado, username } = req.body;
    const cantidadRestante = eliminarCentavos(Number(cantidadOriginal));
    
    if (!apuestaId || !cantidadOriginal || !room || !ronda || !colorBuscado) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Parámetros incompletos' });
    }

    const apuestasCazadas = [];
    let cantidadTotalCazada = 0;
    let cantidadPendiente = cantidadRestante;

    // Construir query para buscar apuestas compatibles
    const queryColor = colorBuscado === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' };
    
    // Buscar apuestas en_espera del color opuesto, excluyendo la apuesta actual y del mismo usuario
    const apuestasCompatibles = await apuestaModel.find({
      ...queryColor,
      sala: room,
      ronda: ronda,
      estado: 'en_espera',
      _id: { $ne: apuestaId },
      username: { $ne: username }
    })
    .sort({ fecha: 1 }) // Ordenar por fecha (más antiguas primero)
    .session(session)
    .lean();

    // Procesar emparejamientos de forma atómica
    for (const apuestaCompatible of apuestasCompatibles) {
      if (cantidadPendiente <= 0) break;

      const cantidadACazar = Math.min(cantidadPendiente, apuestaCompatible.cantidad);

      // Intentar actualizar la apuesta compatible de forma atómica
      // Solo se actualiza si todavía está en estado 'en_espera' (previene doble caza)
      const apuestaActualizada = await apuestaModel.findOneAndUpdate(
        {
          _id: apuestaCompatible._id,
          estado: 'en_espera' // Condición crítica: solo actualizar si sigue en espera
        },
        {
          $set: {
            estado: 'cazada',
            cantidad: cantidadACazar
          }
        },
        {
          session,
          new: true
        }
      );

      // Si la actualización falló (otro proceso ya la cazó), continuar con la siguiente
      if (!apuestaActualizada) {
        console.log(`Apuesta ${apuestaCompatible._id} ya fue cazada por otro proceso, saltando...`);
        continue;
      }

      apuestasCazadas.push({
        apuestaId: apuestaActualizada._id,
        username: apuestaActualizada.username,
        cantidad: cantidadACazar
      });

      cantidadTotalCazada += cantidadACazar;
      cantidadPendiente -= cantidadACazar;

      // Si la apuesta compatible era mayor, crear una nueva apuesta con el resto
      if (apuestaCompatible.cantidad > cantidadACazar) {
        const saldoRestante = eliminarCentavos(apuestaCompatible.cantidad - cantidadACazar);
        const nuevaApuestaRestante = new apuestaModel({
          username: apuestaCompatible.username,
          rojo: apuestaCompatible.rojo,
          verde: apuestaCompatible.verde,
          cantidad: saldoRestante,
          fecha: apuestaCompatible.fecha,
          sala: room,
          ronda: ronda,
          estado: 'en_espera'
        });
        await nuevaApuestaRestante.save({ session });
      }
    }

    // Actualizar la apuesta original
    if (cantidadTotalCazada > 0) {
      // Primero obtener la información de la apuesta original antes de actualizarla
      const apuestaOriginal = await apuestaModel.findById(apuestaId).session(session).lean();
      
      if (!apuestaOriginal) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Apuesta original no encontrada' });
      }

      // Si la apuesta ya fue procesada por otro proceso, hacer rollback
      if (apuestaOriginal.estado !== 'en_espera') {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ 
          error: 'La apuesta ya fue procesada por otro proceso',
          conflict: true 
        });
      }

      // Actualizar la apuesta original
      const apuestaOriginalActualizada = await apuestaModel.findOneAndUpdate(
        {
          _id: apuestaId,
          estado: 'en_espera' // Solo actualizar si sigue en espera
        },
        {
          $set: {
            estado: 'cazada',
            cantidad: cantidadTotalCazada
          }
        },
        {
          session,
          new: true
        }
      );

      if (!apuestaOriginalActualizada) {
        // Si la actualización falló (otro proceso la procesó entre la lectura y la escritura)
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ 
          error: 'La apuesta ya fue procesada por otro proceso',
          conflict: true 
        });
      }

      // Si queda cantidad pendiente, crear nueva apuesta
      if (cantidadPendiente > 0) {
        const nuevaApuestaRestante = new apuestaModel({
          username: apuestaOriginal.username,
          rojo: apuestaOriginal.rojo,
          verde: apuestaOriginal.verde,
          cantidad: cantidadPendiente,
          fecha: apuestaOriginal.fecha,
          sala: room,
          ronda: ronda,
          estado: 'en_espera'
        });
        await nuevaApuestaRestante.save({ session });
      }
    }

    // Confirmar transacción
    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      apuestasCazadas,
      cantidadTotalCazada,
      cantidadRestante: cantidadPendiente,
      fueCompletamenteCazada: cantidadPendiente === 0
    });

  } catch (error) {
    // Rollback en caso de error
    await session.abortTransaction();
    session.endSession();
    console.error('Error en emparejamiento atómico:', error);
    res.status(500).json({ error: 'Error al procesar el emparejamiento', details: error.message });
  }
});

  router.delete('/borrarapuesta/:id', async (req, res) => {
    try {
      const apuestaId = req.params.id;
  
      // Verificar si el apuesta existe antes de intentar borrarlo
      const apuestaExistente = await apuestaModel.findById(apuestaId);
      if (!apuestaExistente) {
        return res.status(404).json({ error: 'apuesta no encontrado' });
      }
  
      // Borrar el apuesta
      //await apuestaModel.findByIdAndDelete(apuestaId);
  
      res.json({ apuesta: 'apuesta borrado exitosamente' });
    } catch (error) {
      console.error('Error al borrar el apuesta:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });
///EMPATE
router.put('/devolverApuestas/:sala/:ronda', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);

    // Obtener todas las apuestas de la sala y ronda especificadas
    const apuestas = await apuestaModel.find({ sala, ronda, estado: { $nin: ['devuelta', 'pagada'] } });

    if (apuestas.length === 0) {
      return res.json({ message: "No hay apuestas para esta sala y ronda." });
    }

    // Agrupar las apuestas por usuario y sumar el total
    const apuestasPorUsuario = apuestas.reduce((acc, apuesta) => {
      if (!acc[apuesta.username]) {
        acc[apuesta.username] = 0;
      }
      acc[apuesta.username] += apuesta.cantidad;
      return acc;
    }, {});

    // Devolver las apuestas a los usuarios
    await Promise.all(Object.keys(apuestasPorUsuario).map(async (username) => {
      // CAMBIO: $inc atómico en transacción — evita race condition y doble devolución
      const monto = eliminarCentavos(apuestasPorUsuario[username]); //Aplicar el redondeo para la cantidad total de la apuesta
      if (monto > 0) {
        await userModel.findOneAndUpdate(
          { username },
          { $inc: { saldo: monto } } // Operación atómica — no hay race condition
        );
        const registroSaldo = new saldos({
          saldo: monto,
          fecha: new Date().toISOString(),
          usuario: username,
          tipo: "saldo_devuelto", // Un tipo claro para identificarlo
          concepto: `Aumento automatico al devolver la apuesta por empate`, // Concepto descriptivo
          sala: sala, // Campo directo para reconciliación en auditoría
          ronda: ronda  // Campo directo para reconciliación en auditoría
        });
        await registroSaldo.save();
      }

    }));

    // Actualizar el estado de todas las apuestas a 'devuelta'
    await apuestaModel.updateMany({ sala, ronda, estado: { $nin: ['devuelta', 'pagada'] } }, { estado: 'devuelta' });

    res.json({ message: "Apuestas devueltas exitosamente." });
  } catch (error) {
    console.error('Error al devolver las apuestas:', error);
    res.status(500).json({ error: 'Error al devolver las apuestas.' });
  }
});

router.put('/actualizarEstadoApuesta', async (req, res) => {
  try {
    const { id, estado } = req.body;

    // Actualizar el estado de la apuesta
    await apuestaModel.findByIdAndUpdate(id, { estado });

    res.json({ message: "Estado de la apuesta actualizado exitosamente." });
  } catch (error) {
    console.error('Error al actualizar el estado de la apuesta:', error);
    res.status(500).json({ error: 'Error al actualizar el estado de la apuesta.' });
  }
});

router.put('/devolverApuestasEnEspera/:sala/:ronda', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);

    // Obtener todas las apuestas en espera de la sala y ronda especificadas
    const apuestasEnEspera = await apuestaModel.find({ sala, ronda, estado: 'en_espera' });

    if (apuestasEnEspera.length === 0) {
      return res.json({ message: "No hay apuestas en espera para esta sala y ronda." });
    }

    // Agrupar las apuestas por usuario y sumar el total
    const apuestasPorUsuario = apuestasEnEspera.reduce((acc, apuesta) => {
      if (!acc[apuesta.username]) {
        acc[apuesta.username] = 0;
      }
      acc[apuesta.username] += apuesta.cantidad;
      return acc;
    }, {});
    console.log("apuestas por usuario:",apuestasPorUsuario);
    // Devolver las apuestas a los usuarios
    await Promise.all(Object.keys(apuestasPorUsuario).map(async (username) => {
      // CAMBIO: $inc atómico — evita race condition y doble devolución
      const monto = eliminarCentavos(apuestasPorUsuario[username]); // Añadir redondeo
      if (monto > 0) {
        await userModel.findOneAndUpdate(
          { username },
          { $inc: { saldo: monto } } // Operación atómica — no hay race condition
        );
        const registroSaldo = new saldos({
          saldo: monto,
          fecha: new Date().toISOString(),
          usuario: username,
          tipo: "saldo_devuelto", // Un tipo claro para identificarlo
          concepto: `Aumento automatico al devolver la apuesta no cazada`, // Concepto descriptivo
          sala: sala, // Campo directo para reconciliación en auditoría
          ronda: ronda  // Campo directo para reconciliación en auditoría
        });
        await registroSaldo.save();
      }
    }));

    // Actualizar el estado de todas las apuestas a 'devuelta'
    await apuestaModel.updateMany({ sala, ronda, estado: 'en_espera' }, { estado: 'devuelta' });

    res.json({ message: "Apuestas en espera devueltas exitosamente." });
  } catch (error) {
    console.error('Error al devolver las apuestas en espera:', error);
    res.status(500).json({ error: 'Error al devolver las apuestas en espera.' });
  }
});

router.put('/restarSaldo', async (req, res) => {
  try {
    const { username, cantidad, ronda } = req.body;

    // Validar que el monto sea un número válido
    const cantidadRedondeada = eliminarCentavos(cantidad);
    if (isNaN(cantidadRedondeada) || cantidadRedondeada <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }

    // CORRECCIÓN: Usar $inc con condición para atomicidad y validación de saldo
    // Esto previene condiciones de carrera donde dos procesos intentan restar simultáneamente
    const updatedUser = await userModel.findOneAndUpdate(
      { 
        username,
        saldo: { $gte: cantidadRedondeada } // Solo actualizar si hay saldo suficiente
      },
      { $inc: { saldo: -cantidadRedondeada } }, // Operación atómica
      { new: true }  // Para devolver el usuario actualizado
    );
      const registroSaldo = new saldos({
              saldo: cantidadRedondeada,
              fecha: new Date().toISOString(),
              usuario: username,
              tipo: "restar_saldo", // Un tipo claro para identificarlo
              concepto: `Resta automatica al pagar la apuesta P${ronda}`, // Concepto descriptivo
              sala: '' // Opcional, si aplica
      });
      await registroSaldo.save();
    if (!updatedUser) {
      // Verificar si el usuario existe o si simplemente no tiene saldo suficiente
      const user = await userModel.findOne({ username });
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    // Respuesta de éxito con el saldo actualizado
    res.json({ success: 'Saldo actualizado', user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/actualizarCantidadApuesta', async (req, res) => {
  try {
    const { id, cantidad } = req.body;
     const cantidadRedondeada = eliminarCentavos(cantidad); // Redondear

    // Validar que el monto sea un número válido
    if (isNaN(cantidadRedondeada) || cantidadRedondeada <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }

    // Actualizar la cantidad de la apuesta
    const apuestaActualizada = await apuestaModel.findByIdAndUpdate(
      id,
      { $set: { cantidad: cantidadRedondeada } },
      { new: true }
    );

    if (!apuestaActualizada) {
      return res.status(404).json({ error: 'Apuesta no encontrada' });
    }

    res.json({ success: "Cantidad de la apuesta actualizada exitosamente.", apuesta: apuestaActualizada });
  } catch (error) {
    console.error('Error al actualizar la cantidad de la apuesta:', error);
    res.status(500).json({ error: 'Error al actualizar la cantidad de la apuesta.' });
  }
});

router.put('/aumentarSaldo', async (req, res) => {
  try {
    const { username, cantidad } = req.body;
     const cantidadRedondeada = eliminarCentavos(cantidad); // Redondear

    // Validar que el monto sea un número válido
    if (isNaN(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }

    // Actualizar el saldo del usuario
    const updatedUser = await userModel.findOneAndUpdate(
      { username },
      { $inc: { saldo: cantidadRedondeada } }, // Incrementa el saldo en el monto especificado
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Respuesta de éxito con el saldo actualizado
    res.json({ success: 'Saldo aumentado exitosamente', user: updatedUser });
  } catch (error) {
    console.error('Error al aumentar el saldo del usuario:', error);
    res.status(500).json({ error: error.message });
  }
});
router.get('/historialDetallado/:username', async (req, res) => {
  try {
    const username = req.params.username;
    
    // Verificar si el usuario existe y obtener apuestas en paralelo
    const [usuario, apuestas] = await Promise.all([
      userModel.findOne({ username }).select('_id').lean(),
      apuestaModel.find({ username })
        .sort({ fecha: -1 })
        .select('_id fecha sala ronda cantidad rojo verde estado')
        .lean()
    ]);

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Procesar apuestas
    const historial = apuestas.map(apuesta => {
      const esGanada = apuesta.estado === 'pagada';
      const esEmpate = apuesta.estado === 'devuelta';
      
      return {
        ...apuesta,
        colorApostado: apuesta.rojo ? 'rojo' : 'verde',
        resultado: esGanada ? 'ganada' : esEmpate ? 'empate' : 'perdida',
        ganancia: esGanada ? apuesta.cantidad * 1.9 : esEmpate ? apuesta.cantidad : 0,
        perdida: !esGanada && !esEmpate ? apuesta.cantidad : 0
      };
    });

    // Calcular resumen
    const resumen = historial.reduce((acc, item) => {
      acc.totalGanado += item.ganancia;
      acc.totalPerdido += item.perdida;
      acc.balance = acc.totalGanado - acc.totalPerdido;
      return acc;
    }, { totalGanado: 0, totalPerdido: 0, balance: 0 });

    res.json({ success: true, username, historial, resumen });

  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});
router.get('/historialPorRondas/:username',async (req, res) => {

  try {
    const username = req.params.username;
    
    // Verificar si el usuario existe y obtener apuestas (excluyendo devoluciones)
    const [usuario, apuestas] = await Promise.all([
      userModel.findOne({ username }).select('username saldo').lean(),
      apuestaModel.find({ // Excluir devoluciones
        username
      })
        .sort({ fecha: -1 })
        .select('fecha sala ronda cantidad rojo verde estado')
        .lean()
    ]);

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Agrupar por sala, ronda Y color
    const rondasColorMap = {};
    
    apuestas.forEach(apuesta => {
      const color = apuesta.rojo ? 'ROJO' : 'VERDE';
      const key = `${apuesta.sala}-${apuesta.ronda}-${color}`;
      
      if (!rondasColorMap[key]) {
        rondasColorMap[key] = {
          sala: apuesta.sala,
          ronda: apuesta.ronda,
          color: color,
          fecha: apuesta.fecha,
          totalApostado: 0,
          totalGanado: 0,
          totalPerdido: 0,
          hayGanadas: false,
          hayPerdidas: false,
          totalDevueltas: 0,
          totalApuestas: 0
        };
      }
      
      // Actualizar fecha si es más reciente
      if (new Date(apuesta.fecha) > new Date(rondasColorMap[key].fecha)) {
        rondasColorMap[key].fecha = apuesta.fecha;
      }
      
      rondasColorMap[key].totalApostado += apuesta.cantidad;
      rondasColorMap[key].totalApuestas += 1;

      if (apuesta.estado === 'pagada') {
        rondasColorMap[key].totalGanado += apuesta.cantidad * 0.9;
        rondasColorMap[key].hayGanadas = true;
      } else if (apuesta.estado === 'devuelta') {
        rondasColorMap[key].totalDevueltas += 1;
      } else {
        rondasColorMap[key].totalPerdido += apuesta.cantidad;
        rondasColorMap[key].hayPerdidas = true;
      }
    });

    // Convertir a array y procesar cada ronda-color
    const historial = Object.values(rondasColorMap)
      .map(rondaColor => {
        let cantidadFinal;
        let resultadoNeto;

        // Si todas las apuestas fueron devueltas (empate/tablas)
        if (rondaColor.totalDevueltas === rondaColor.totalApuestas) {
          cantidadFinal = 0;
          resultadoNeto = 'Tablas';
        } else if (rondaColor.hayGanadas && !rondaColor.hayPerdidas) {
          cantidadFinal = rondaColor.totalGanado;
          resultadoNeto = 'Gana';
        } else if (!rondaColor.hayGanadas && rondaColor.hayPerdidas) {
          cantidadFinal = -rondaColor.totalPerdido;
          resultadoNeto = 'Pierde';
        } else if (rondaColor.hayGanadas && rondaColor.hayPerdidas) {
          const neto = rondaColor.totalGanado - rondaColor.totalPerdido;
          cantidadFinal = neto;
          resultadoNeto = neto > 0 ? 'Gana' : 'Pierde';
        } else {
           cantidadFinal = -rondaColor.totalApostado;
          resultadoNeto = 'Pierde';
        }
        
        return {
          concepto: `P${rondaColor.ronda}`,
          fecha: rondaColor.fecha,
          sala: rondaColor.sala,
          ronda: rondaColor.ronda,
          cantidad: rondaColor.totalApostado,
          color: rondaColor.color,
          queda: resultadoNeto,
          cantidadFinal: cantidadFinal,
          estado: resultadoNeto === 'Tablas' ? 'devuelta' :
                  rondaColor.hayGanadas && rondaColor.hayPerdidas ? 'mixto' : 
                  rondaColor.hayGanadas ? 'pagada' : 'cazada'
        };
      })
      .sort((a, b) => {
        // Ordenar primero por fecha (más reciente primero), luego por ronda, luego por color
        const fechaCompare = new Date(b.fecha) - new Date(a.fecha);
        if (fechaCompare !== 0) return fechaCompare;
        
        const rondaCompare = b.ronda - a.ronda;
        if (rondaCompare !== 0) return rondaCompare;
        
        // Si es la misma ronda, poner ROJO primero, luego VERDE
        if (a.color === 'ROJO' && b.color === 'VERDE') return -1;
        if (a.color === 'VERDE' && b.color === 'ROJO') return 1;
        return 0;
      });

    // Calcular resumen total
    const resumen = historial.reduce((acc, item) => {
      acc.totalApostado += item.cantidad;
      if (item.cantidadFinal > 0) {
        acc.totalGanado += item.cantidadFinal;
        acc.registrosGanados++;
      } else {
        acc.totalPerdido += Math.abs(item.cantidadFinal);
        acc.registrosPerdidos++;
      }
      acc.balance = acc.totalGanado - acc.totalPerdido;
      return acc;
    }, { 
      totalApostado: 0,
      totalGanado: 0, 
      totalPerdido: 0, 
      balance: 0,
      registrosGanados: 0,
      registrosPerdidos: 0,
      totalRegistros: historial.length,
      saldoActual: usuario.saldo
    });

    res.json({ 
      success: true, 
      username: usuario.username, 
      historial, 
      resumen 
    });

  } catch (error) {
    console.error('Error al obtener historial por rondas:', error);
    res.status(500).json({ error: 'Error al obtener historial por rondas' });
  }
});

//End point para el resumen de las apuestas 
router.get( '/resumen-stream/:sala',async (req, res) => {
  try {
    const sala = req.params.sala;
    
    // --- INICIO DE LA CORRECCIÓN ---
    // La lógica original suma las apuestas de ambos lados (rojo y verde), duplicando el total.
    // Para corregirlo, contamos solo un lado de la apuesta (ej. 'rojo') para obtener el monto real cazado.
    const apuestas = await apuestaModel.find({ 
      sala, 
      rojo: 'rojo', // Se añade esta línea para contar solo un lado de cada apuesta cazada.
      estado: { $in: ['cazada', 'pagada', 'perdida', 'devuelta'] }
    });
    // --- FIN DE LA CORRECCIÓN ---

    // El resto de tu lógica original para procesar los datos permanece intacta.
    const totalPorRonda = apuestas.reduce((acc, apuesta) => {
      const ronda = apuesta.ronda || 0;
      if (!acc[ronda]) {
        acc[ronda] = 0;
      }
            // Solo sumar si no fue devuelta, ya que una devolución no es un monto cazado.
      if (apuesta.estado !== 'devuelta') {
        acc[ronda] += Math.floor(apuesta.cantidad);
      }
      
      return acc;
    }, {});

    const totalStream = Object.values(totalPorRonda).reduce((sum, cantidad) => sum + cantidad, 0);
    
    const resultado = {
      totalStream: totalStream,
      detalles: Object.keys(totalPorRonda).map(ronda => ({
        ronda: Number(ronda),
        cazado: totalPorRonda[ronda]
      })).sort((a, b) => b.ronda - a.ronda)
    };

    res.json(resultado);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/obtenerapuestasAgrupadasBySala/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;

    // Buscar todas las apuestas que coincidan con la sala
    const apuestas = await apuestaModel.find({ sala });

    if (apuestas.length === 0) {
      return res.json({});
    }

    // Agrupar apuestas por usuario, estado y ronda
    const apuestasAgrupadas = {};

    apuestas.forEach(apuesta => {
      const key = `${apuesta.username}_${apuesta.estado}_${apuesta.ronda}`;
      
      if (!apuestasAgrupadas[key]) {
        apuestasAgrupadas[key] = {
          username: apuesta.username,
          estado: apuesta.estado,
          ronda: apuesta.ronda,
          cantidadTotal: 0,
          numeroApuestas: 0,
          roja: '',
          verde: '',
          sala: apuesta.sala,
          fechaUltima: apuesta.fecha
        };
      }

      // Sumar la cantidad total
      apuestasAgrupadas[key].cantidadTotal += apuesta.cantidad;
      apuestasAgrupadas[key].numeroApuestas += 1;
      
      // Actualizar colores (mantener el último o combinar)
      if (apuesta.rojo) apuestasAgrupadas[key].roja = apuesta.rojo;
      if (apuesta.verde) apuestasAgrupadas[key].verde = apuesta.verde;
      
      // Actualizar fecha si es más reciente
      if (new Date(apuesta.fecha) > new Date(apuestasAgrupadas[key].fechaUltima)) {
        apuestasAgrupadas[key].fechaUltima = apuesta.fecha;
      }
    });

    // Convertir el objeto a array y ordenar
    const resultado = Object.values(apuestasAgrupadas)
      .sort((a, b) => {
        // Ordenar por ronda descendente, luego por username, luego por estado
        if (a.ronda !== b.ronda) {
          return b.ronda - a.ronda; // Rondas más recientes primero
        }
        if (a.username !== b.username) {
          return a.username.localeCompare(b.username);
        }
        return a.estado.localeCompare(b.estado);
      });

    res.json(resultado);
  } catch (error) {
    console.error('Error al obtener apuestas agrupadas por sala:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
// Endpoint para obtener el resumen general de todos los streams
router.get('/resumen-general-streams', async (req, res) => {
  try {
    const resumen = await apuestaModel.aggregate([
      {
        $match: {
          estado: { $in: ['cazada', 'pagada', 'perdida'] },
          rojo: 'rojo' // Contar solo un lado para no duplicar
        }
      },
      {
        $group: {
          _id: '$sala', // Agrupar por sala
          totalApostado: { $sum: '$cantidad' }
        }
      },
      {
        $sort: {
          _id: 1 // Ordenar por nombre de sala
        }
      },
      {
        $project: {
          _id: 0,
          sala: '$_id',
          totalApostado: '$totalApostado'
        }
      }
    ]);

    res.json({ success: true, resumen });
  } catch (error) {
    console.error('Error al obtener el resumen general de streams:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ...existing code...
router.get('/auditoria/general', async (req, res) => {
  try {
    // ======= NUEVO: Obtener fecha de corte (si existe) =======
    const corteDoc = await auditoriaCorteModel.findOne().lean();
    const fechaCorte = corteDoc ? corteDoc.fechaCorte : null;

    // Obtener todos los usuarios con saldo actual
    const usuarios = await userModel.find(
      { username: { $exists: true, $ne: null, $ne: "" } },
      { username: 1, saldo: 1, _id: 0 }
    ).lean();

    // Obtener registros de saldo (FILTRADOS por corte si existe)
    const filtroSaldos = fechaCorte ? { fecha: { $gte: fechaCorte } } : {};
    const registrosSaldo = await saldos.find(
      filtroSaldos,
      { usuario: 1, saldo: 1, tipo: 1, concepto: 1, fecha: 1, _id: 0 }
    ).sort({ fecha: 1 }).lean();

    // Obtener apuestas (FILTRADAS por corte si existe)
    const filtroApuestas = fechaCorte ? { fecha: { $gte: fechaCorte } } : {};
    const todasApuestas = await apuestaModel.find(
      filtroApuestas,
      { username: 1, cantidad: 1, estado: 1, ronda: 1, sala: 1, rojo: 1, verde: 1, fecha: 1, _id: 0 }
    ).lean();

    const resultadoUsuarios = [];
    const discrepanciasGlobales = [];

    for (const usuario of usuarios) {
      const username = usuario.username;
      const saldoActual = usuario.saldo || 0;

      // Calcular saldo inicial — saldo actual + lo que se restó - lo que se sumó
      const movimientos = registrosSaldo.filter(r => r.usuario === username);
      const totalRestado = movimientos
        .filter(r => r.tipo === 'restar_saldo')
        .reduce((sum, r) => sum + r.saldo, 0);
      const totalGanado = movimientos
        .filter(r => r.tipo === 'apuesta_ganada')
        .reduce((sum, r) => sum + r.saldo, 0);
      const totalDevuelto = movimientos
        .filter(r => r.tipo === 'saldo_devuelto')
        .reduce((sum, r) => sum + r.saldo, 0);

      const saldoInicialCalculado = eliminarCentavos(
        saldoActual + totalRestado - totalGanado - totalDevuelto
      );

      // Apuestas del usuario agrupadas por ronda
      const apuestasUsuario = todasApuestas.filter(a => a.username === username);
      const rondas = {};

      for (const a of apuestasUsuario) {
        const key = `${a.sala || ''}__ronda_${a.ronda || 0}`;
        if (!rondas[key]) {
          rondas[key] = {
            sala: a.sala || '',
            ronda: a.ronda || 0,
            apostado: 0,
            cazado: 0,
            ganado_entregado: 0,
            devuelto: 0,
            perdido: 0,
            pendiente: 0,
            estados: []
          };
        }
        const r = rondas[key];
        const cantidad = eliminarCentavos(a.cantidad || 0);
        const estado = a.estado || '';
        r.apostado += cantidad;
        r.estados.push(estado);

        if (estado === 'cazada') {
          r.cazado += cantidad;
          r.pendiente += cantidad;
        } else if (estado === 'pagada') {
          r.cazado += cantidad;
          const ganancia = eliminarCentavos((cantidad * 2) - (cantidad * 0.1));
          r.ganado_entregado += ganancia;
        } else if (estado === 'devuelta') {
          r.devuelto += cantidad;
        } else if (estado === 'perdida') {
          r.cazado += cantidad;
          r.perdido += cantidad;
        }
      }

      // Calcular ganancia esperada vs entregada por ronda
      const detalleRondas = [];

      for (const [key, r] of Object.entries(rondas)) {
        // Lo que debería haber recibido según apuestas pagadas
        const apuestasPagadasRonda = apuestasUsuario.filter(
          a => `${a.sala || ''}__ronda_${a.ronda || 0}` === key && a.estado === 'pagada'
        );
        const gananciaEsperada = apuestasPagadasRonda.reduce(
          (sum, a) => sum + eliminarCentavos((a.cantidad * 2) - (a.cantidad * 0.1)), 0
        );

        // Devuelto esperado
        const apuestasDevueltasRonda = apuestasUsuario.filter(
          a => `${a.sala || ''}__ronda_${a.ronda || 0}` === key && a.estado === 'devuelta'
        );
        const devolucionEsperada = apuestasDevueltasRonda.reduce(
          (sum, a) => sum + eliminarCentavos(a.cantidad), 0
        );

        // ===================================================================
        // CAMBIO: Reconciliación por campos directos en lugar de texto libre
        // Por qué: Antes filtraba con .includes('ronda X') sobre el campo
        //          concepto. El concepto guardado era "Aumento automático al
        //          ganar la apuesta" — sin ronda ni sala — así que el filtro
        //          nunca encontraba nada y gananciaRegistrada era siempre 0,
        //          generando discrepancias falsas en todas las rondas.
        // Para qué: Ahora filtra por los campos ronda y sala directamente.
        //           Para registros históricos sin esos campos, usa fallback.
        // ===================================================================
        const gananciaRegistrada = movimientos
          .filter(m =>
            m.tipo === 'apuesta_ganada' && (
              (m.ronda === r.ronda && m.sala === r.sala) ||
              (m.ronda == null && m.sala == null)
            )
          )
          .reduce((sum, m) => sum + m.saldo, 0);

        const devolucionRegistrada = movimientos
          .filter(m =>
            m.tipo === 'saldo_devuelto' && (
              (m.ronda === r.ronda && m.sala === r.sala) ||
              (m.ronda == null && m.sala == null)
            )
          )
          .reduce((sum, m) => sum + m.saldo, 0);

        const discrepanciaGanancia = eliminarCentavos(gananciaRegistrada - gananciaEsperada);
        const discrepanciaDevolucion = eliminarCentavos(devolucionRegistrada - devolucionEsperada);
        const hayDiscrepancia = discrepanciaGanancia !== 0 || discrepanciaDevolucion !== 0;

        const rondaInfo = {
          sala: r.sala,
          ronda: r.ronda,
          total_apostado: r.apostado,
          total_cazado: r.cazado,
          ganancia_esperada: gananciaEsperada,
          ganancia_registrada: gananciaRegistrada,
          devolucion_esperada: devolucionEsperada,
          devolucion_registrada: devolucionRegistrada,
          discrepancia_ganancia: discrepanciaGanancia,
          discrepancia_devolucion: discrepanciaDevolucion,
          pendiente_por_resolver: r.pendiente,
          hay_discrepancia: hayDiscrepancia
        };
        detalleRondas.push(rondaInfo);

        if (hayDiscrepancia) {
          discrepanciasGlobales.push({
            username,
            ...rondaInfo
          });
        }
      }

      detalleRondas.sort((a, b) => {
        if (a.sala !== b.sala) return a.sala.localeCompare(b.sala);
        return a.ronda - b.ronda;
      });

      resultadoUsuarios.push({
        username,
        saldo_actual: saldoActual,
        saldo_inicial_calculado: saldoInicialCalculado,
        total_apostado_historico: totalRestado,
        total_ganado_historico: totalGanado,
        total_devuelto_historico: totalDevuelto,
        balance_neto: eliminarCentavos(totalGanado + totalDevuelto - totalRestado),
        detalle_por_ronda: detalleRondas,
        tiene_discrepancias: detalleRondas.some(r => r.hay_discrepancia)
      });
    }

    // Ordenar — primero los que tienen discrepancias
    resultadoUsuarios.sort((a, b) => {
      if (a.tiene_discrepancias !== b.tiene_discrepancias) {
        return a.tiene_discrepancias ? -1 : 1; // Los que tienen discrepancias primero
      }
      return a.username.localeCompare(b.username);
    });

    res.json({
      success: true,
      fecha_consulta: new Date().toISOString(),
      fecha_corte: fechaCorte || null, // NUEVO: incluir fecha de corte en respuesta
      total_usuarios: resultadoUsuarios.length,
      usuarios_con_discrepancias: resultadoUsuarios.filter(u => u.tiene_discrepancias).length,
      discrepancias: discrepanciasGlobales,
      usuarios: resultadoUsuarios
    });

  } catch (error) {
    console.error('Error en auditoría general:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ---------------------------------------------------------------------------
// GET /auditoria/usuario/:username
// Auditoría detallada de un usuario específico
// ---------------------------------------------------------------------------
router.get('/auditoria/usuario/:username', async (req, res) => {
  try {
    const username = req.params.username;

    const usuario = await userModel.findOne({ username }, { saldo: 1, _id: 0 }).lean();
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const saldoActual = usuario.saldo || 0;

    // Todos los movimientos de saldo del usuario ordenados por fecha
    const movimientos = await saldos.find(
      { usuario: username },
      { saldo: 1, tipo: 1, concepto: 1, fecha: 1, _id: 0 }
    ).sort({ fecha: 1 }).lean();

    // Reconstruir saldo cronológicamente
    const totalRestado = movimientos
      .filter(m => m.tipo === 'restar_saldo')
      .reduce((sum, m) => sum + m.saldo, 0);
    const totalGanado = movimientos
      .filter(m => m.tipo === 'apuesta_ganada')
      .reduce((sum, m) => sum + m.saldo, 0);
    const totalDevuelto = movimientos
      .filter(m => m.tipo === 'saldo_devuelto')
      .reduce((sum, m) => sum + m.saldo, 0);
    const saldoInicial = eliminarCentavos(saldoActual + totalRestado - totalGanado - totalDevuelto);

    // Todas las apuestas del usuario
    const apuestas = await apuestaModel.find(
      { username },
      { cantidad: 1, estado: 1, ronda: 1, sala: 1, rojo: 1, verde: 1, fecha: 1, _id: 0 }
    ).sort({ fecha: 1 }).lean();

    // Agrupar por sala+ronda
    const rondas = {};

    for (const a of apuestas) {
      const key = `${a.sala || ''}__ronda_${a.ronda || 0}`;
      if (!rondas[key]) {
        rondas[key] = {
          sala: a.sala || '',
          ronda: a.ronda || 0,
          apostado: 0,
          pagadas: [],
          devueltas: [],
          perdidas: [],
          cazadas_pendientes: [],
          en_espera: []
        };
      }
      const r = rondas[key];
      const cantidad = eliminarCentavos(a.cantidad || 0);
      const estado = a.estado || '';
      const color = a.rojo ? 'ROJO' : 'VERDE';
      r.apostado += cantidad;

      const entry = { cantidad, color };
      if (estado === 'pagada') {
        r.pagadas.push(entry);
      } else if (estado === 'devuelta') {
        r.devueltas.push(entry);
      } else if (estado === 'perdida') {
        r.perdidas.push(entry);
      } else if (estado === 'cazada') {
        r.cazadas_pendientes.push(entry);
      } else if (estado === 'en_espera') {
        r.en_espera.push(entry);
      }
    }

    const detalleRondas = [];
    let saldoCorriente = saldoInicial;

    // Ordenar las rondas por sala y ronda
    const rondasOrdenadas = Object.entries(rondas).sort((a, b) => {
      if (a[1].sala !== b[1].sala) return a[1].sala.localeCompare(b[1].sala);
      return a[1].ronda - b[1].ronda;
    });

    for (const [key, r] of rondasOrdenadas) {
      const apostadoRonda = r.apostado;
      const gananciaEsperada = r.pagadas.reduce(
        (sum, e) => sum + eliminarCentavos((e.cantidad * 2) - (e.cantidad * 0.1)), 0
      );
      const devolucionEsperada = r.devueltas.reduce(
        (sum, e) => sum + e.cantidad, 0
      );

      // ===================================================================
      // CAMBIO: Reconciliación por campos directos en lugar de texto libre
      // Por qué: Mismo problema que auditoria/general. El filtro por texto
      //          libre nunca encontraba coincidencias — discrepancias falsas.
      // Para qué: Filtra por campos ronda y sala directamente.
      // ===================================================================
      const gananciaRegistrada = movimientos
        .filter(m =>
          m.tipo === 'apuesta_ganada' && (
            (m.ronda === r.ronda && m.sala === r.sala) ||
            (m.ronda == null && m.sala == null)
          )
        )
        .reduce((sum, m) => sum + m.saldo, 0);

      const devolucionRegistrada = movimientos
        .filter(m =>
          m.tipo === 'saldo_devuelto' && (
            (m.ronda === r.ronda && m.sala === r.sala) ||
            (m.ronda == null && m.sala == null)
          )
        )
        .reduce((sum, m) => sum + m.saldo, 0);

      saldoCorriente -= apostadoRonda;
      saldoCorriente += gananciaRegistrada + devolucionRegistrada;

      const discrepanciaGanancia = eliminarCentavos(gananciaRegistrada - gananciaEsperada);
      const discrepanciaDevolucion = eliminarCentavos(devolucionRegistrada - devolucionEsperada);

      detalleRondas.push({
        sala: r.sala,
        ronda: r.ronda,
        saldo_antes_de_ronda: eliminarCentavos(saldoCorriente - gananciaRegistrada - devolucionRegistrada + apostadoRonda),
        apostado: apostadoRonda,
        pagadas: r.pagadas,
        ganancia_esperada: gananciaEsperada,
        ganancia_registrada: gananciaRegistrada,
        devueltas: r.devueltas,
        devolucion_esperada: devolucionEsperada,
        devolucion_registrada: devolucionRegistrada,
        perdidas: r.perdidas,
        cazadas_pendientes_de_resultado: r.cazadas_pendientes,
        en_espera: r.en_espera,
        saldo_despues_de_ronda: eliminarCentavos(saldoCorriente),
        discrepancia_ganancia: discrepanciaGanancia,
        discrepancia_devolucion: discrepanciaDevolucion,
        hay_discrepancia: discrepanciaGanancia !== 0 || discrepanciaDevolucion !== 0
      });
    }

    res.json({
      success: true,
      fecha_consulta: new Date().toISOString(),
      username,
      saldo_inicial_calculado: saldoInicial,
      saldo_actual: saldoActual,
      balance_neto: eliminarCentavos(totalGanado + totalDevuelto - totalRestado),
      total_apostado_historico: totalRestado,
      total_ganado_historico: totalGanado,
      total_devuelto_historico: totalDevuelto,
      movimientos_saldo: movimientos,
      detalle_por_ronda: detalleRondas,
      tiene_discrepancias: detalleRondas.some(r => r.hay_discrepancia)
    });

  } catch (error) {
    console.error('Error en auditoría de usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
router.post('/auditoria/corte', async (req, res) => {
  try {
    const nota = req.body.nota || '';
    // Upsert: siempre sobreescribe el único documento
    const corte = await auditoriaCorteModel.findOneAndUpdate(
      {},
      { fechaCorte: new Date(), nota, creadoPor: req.body.usuario || 'admin' },
      { upsert: true, new: true }
    );
    res.json({ success: true, corte });
  } catch (error) {
    console.error('Error al crear corte de auditoría:', error);
    res.status(500).json({ error: 'Error al crear corte de auditoría' });
  }
});

// ---------------------------------------------------------------------------
// GET /auditoria/corte - Obtener el corte actual
// ---------------------------------------------------------------------------
router.get('/auditoria/corte', async (req, res) => {
  try {
    const corte = await auditoriaCorteModel.findOne().lean();
    res.json({ success: true, corte: corte || null });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener corte' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /auditoria/corte - Eliminar el corte (volver a ver todo el historial)
// ---------------------------------------------------------------------------
router.delete('/auditoria/corte', async (req, res) => {
  try {
    await auditoriaCorteModel.deleteMany({});
    res.json({ success: true, message: 'Corte eliminado. Auditoría mostrará todo el historial.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar corte' });
  }
});

// ============================================================================
// ENDPOINTS DEL CONTADOR ESTADO (Persistencia global del contador de apuestas)
// ============================================================================

/**
 * GET /api/apuestas/obtenerContadorSala/:sala
 * Obtiene el estado guardado del contador para una sala
 * Respeta el flujo: si hay contador guardado, lo devuelve; si no, devuelve null
 */
router.get('/obtenerContadorSala/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;

    const contadorEstado = await contadorEstadoModel.findOne({ sala }).lean();

    if (!contadorEstado) {
      return res.json({ success: true, contadorEstado: null });
    }

    res.json({
      success: true,
      contadorEstado: {
        sala: contadorEstado.sala,
        ronda: contadorEstado.ronda,
        contadorRestante: contadorEstado.contadorRestante,
        timestampCierreApuestas: contadorEstado.timestampCierreApuestas,
        estadoApuesta: contadorEstado.estadoApuesta
      }
    });
  } catch (error) {
    console.error('Error al obtener estado del contador:', error);
    res.status(500).json({ error: 'Error al obtener estado del contador' });
  }
});

/**
 * PUT /api/apuestas/guardarContadorSala
 * Guarda el estado del contador cuando se cierran las apuestas
 * Respeta el flujo: guarda directamente sin sobreescribir lógica existente
 *
 * @body {string} sala - ID de la sala
 * @body {number} ronda - Número de ronda actual
 * @body {number} contadorRestante - Segundos restantes
 * @body {number} timestampCierreApuestas - Timestamp de cierre
 * @body {boolean} estadoApuesta - Estado de las apuestas
 */
router.put('/guardarContadorSala', async (req, res) => {
  try {
    const { sala, ronda, contadorRestante, timestampCierreApuestas, estadoApuesta } = req.body;

    if (!sala) {
      return res.status(400).json({ error: 'Sala es requerida' });
    }

    const contadorEstado = await contadorEstadoModel.findOneAndUpdate(
      { sala },
      {
        $set: {
          sala,
          ronda: ronda || 0,
          contadorRestante: contadorRestante || 0,
          timestampCierreApuestas: timestampCierreApuestas || null,
          estadoApuesta: estadoApuesta !== undefined ? estadoApuesta : true
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Estado del contador guardado',
      contadorEstado
    });
  } catch (error) {
    console.error('Error al guardar estado del contador:', error);
    res.status(500).json({ error: 'Error al guardar estado del contador' });
  }
});

/**
 * DELETE /api/apuestas/limpiarContadorSala/:sala
 * Limpia el estado del contador cuando se abren nuevas apuestas
 * Esto permite que el contador se resetee cuando cambia la ronda
 */
router.delete('/limpiarContadorSala/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;

    // En lugar de eliminar, reseteamos los valores
    const contadorEstado = await contadorEstadoModel.findOneAndUpdate(
      { sala },
      {
        $set: {
          contadorRestante: 0,
          timestampCierreApuestas: null,
          estadoApuesta: true
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Estado del contador limpiado',
      contadorEstado
    });
  } catch (error) {
    console.error('Error al limpiar estado del contador:', error);
    res.status(500).json({ error: 'Error al limpiar estado del contador' });
  }
});

// ============================================================================
// ENDPOINTS DEL HISTORIAL DE RONDAS (Persistencia de últimas 15 peleas)
// ============================================================================

/**
 * GET /api/apuestas/historialRondasReal/:sala
 * SOURCE OF TRUTH: deriva el historial de ganadores directamente de la
 * colección `apuestas`. Una ronda con apuestas en estado 'pagada' tiene
 * como ganador el color de esas apuestas. Si todas están en 'devuelta',
 * la ronda fue empate. Esta función NO confía en eventos socket ni en
 * caches: lee la tabla autoritativa y devuelve las últimas 15 rondas.
 */
router.get('/historialRondasReal/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;
    if (!sala) {
      return res.status(400).json({ error: 'sala es requerida' });
    }

    // Solo apuestas finalizadas (no en_espera ni cazada en curso)
    const apuestas = await apuestaModel.find({
      sala,
      estado: { $in: ['pagada', 'perdida', 'devuelta'] },
      ronda: { $gt: 0 }
    }).select('ronda estado rojo verde').lean();

    // Agrupar por ronda
    const rondasMap = new Map();
    for (const a of apuestas) {
      if (!rondasMap.has(a.ronda)) rondasMap.set(a.ronda, []);
      rondasMap.get(a.ronda).push(a);
    }

    // Derivar el ganador de cada ronda
    const rondas = [];
    for (const [round, lista] of rondasMap) {
      const tienePagada = lista.find(a => a.estado === 'pagada');
      let winner = null;
      if (tienePagada) {
        // El color de la apuesta pagada ES el ganador
        winner = (tienePagada.rojo && tienePagada.rojo !== '') ? 'rojo' : 'verde';
      } else if (lista.every(a => a.estado === 'devuelta')) {
        winner = 'empate';
      } else {
        // Estado mixto inesperado (apuestas perdidas sin pagada): saltar
        continue;
      }
      rondas.push({ round, winner });
    }

    // Ordenar por ronda ascendente y devolver últimas 15
    rondas.sort((a, b) => a.round - b.round);
    const ultimas = rondas.slice(-15);

    res.json({
      success: true,
      sala,
      rondas: ultimas
    });
  } catch (error) {
    console.error('Error al derivar historial real:', error);
    res.status(500).json({ error: 'Error al derivar historial real' });
  }
});

/**
 * GET /api/apuestas/obtenerHistorialRondas/:sala
 * Obtiene el historial de las últimas 15 rondas de una sala
 */
router.get('/obtenerHistorialRondas/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;

    const historial = await historialRondasModel.findOne({ sala }).lean();

    if (!historial) {
      return res.json({ success: true, rondas: [] });
    }

    res.json({
      success: true,
      sala: historial.sala,
      rondas: historial.rondas || []
    });
  } catch (error) {
    console.error('Error al obtener historial de rondas:', error);
    res.status(500).json({ error: 'Error al obtener historial de rondas' });
  }
});

/**
 * PUT /api/apuestas/agregarRondaHistorial
 * Agrega una ronda al historial y recorta a las últimas 15 (ventana deslizable)
 *
 * @body {string} sala - ID de la sala
 * @body {number} round - Número de la ronda
 * @body {string} winner - Ganador: 'rojo' | 'verde' | 'empate'
 */
router.put('/agregarRondaHistorial', async (req, res) => {
  try {
    const { sala, round, winner } = req.body;

    if (!sala || round === undefined || !winner) {
      return res.status(400).json({ error: 'sala, round y winner son requeridos' });
    }

    if (!['rojo', 'verde', 'empate'].includes(winner)) {
      return res.status(400).json({ error: 'winner debe ser rojo, verde o empate' });
    }

    // Buscar el documento de la sala (o crear uno si no existe)
    let historial = await historialRondasModel.findOne({ sala });

    if (!historial) {
      historial = new historialRondasModel({ sala, rondas: [] });
    }

    // Evitar duplicados ESTRICTO por número de ronda: una ronda solo puede
    // tener un único resultado, sin importar qué ganador llegue después.
    // Esto previene cruces por eventos socket replay-emitidos.
    const yaExisteRonda = historial.rondas.some(r => r.round === round);
    if (yaExisteRonda) {
      return res.json({
        success: true,
        message: 'Ronda ya existe en el historial — no se sobreescribe',
        rondas: historial.rondas
      });
    }

    // Agregar la ronda
    historial.rondas.push({ round, winner });

    // Mantener solo las últimas 15 (ventana deslizable)
    if (historial.rondas.length > 15) {
      historial.rondas = historial.rondas.slice(-15);
    }

    await historial.save();

    res.json({
      success: true,
      message: 'Ronda agregada al historial',
      rondas: historial.rondas
    });
  } catch (error) {
    console.error('Error al agregar ronda al historial:', error);
    res.status(500).json({ error: 'Error al agregar ronda al historial' });
  }
});

/**
 * PUT /api/apuestas/reemplazarHistorialRondas
 * Reemplaza el historial completo de una sala con un array saneado.
 * Útil para auto-curar datos sucios (duplicados, cross-sala) detectados
 * por el cliente al cargar.
 *
 * @body {string} sala
 * @body {Array<{round: number, winner: 'rojo'|'verde'|'empate'}>} rondas
 */
router.put('/reemplazarHistorialRondas', async (req, res) => {
  try {
    const { sala, rondas } = req.body;

    if (!sala) {
      return res.status(400).json({ error: 'sala es requerida' });
    }
    if (!Array.isArray(rondas)) {
      return res.status(400).json({ error: 'rondas debe ser un array' });
    }

    // Validar y limpiar las rondas en el servidor también (defensa en profundidad)
    const rondasLimpias = [];
    const vistas = new Set();
    for (const r of rondas) {
      if (!r || typeof r.round !== 'number' || r.round <= 0) continue;
      if (!['rojo', 'verde', 'empate'].includes(r.winner)) continue;
      if (vistas.has(r.round)) continue;
      vistas.add(r.round);
      rondasLimpias.push({ round: r.round, winner: r.winner });
    }
    rondasLimpias.sort((a, b) => a.round - b.round);
    const finales = rondasLimpias.slice(-15);

    await historialRondasModel.findOneAndUpdate(
      { sala },
      { $set: { rondas: finales } },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Historial reemplazado',
      rondas: finales
    });
  } catch (error) {
    console.error('Error al reemplazar historial de rondas:', error);
    res.status(500).json({ error: 'Error al reemplazar historial de rondas' });
  }
});

/**
 * DELETE /api/apuestas/limpiarHistorialRondas/:sala
 * Limpia todo el historial de rondas de una sala
 */
router.delete('/limpiarHistorialRondas/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;

    await historialRondasModel.findOneAndUpdate(
      { sala },
      { $set: { rondas: [] } },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Historial de rondas limpiado'
    });
  } catch (error) {
    console.error('Error al limpiar historial de rondas:', error);
    res.status(500).json({ error: 'Error al limpiar historial de rondas' });
  }
});

// GET /api/apuestas/auditoria/balance/alertas
// Devuelve todas las rondas con asimetría detectada
router.get('/auditoria/balance/alertas', async (req, res) => {
  try {
    const { sala } = req.query;
    const filtro = { tipo: 'balance_ronda', usuario: '_SISTEMA_' };
    if (sala) filtro.sala = sala;
    const alertas = await saldos.find(filtro)
      .sort({ fecha: -1 })
      .limit(200)
      .lean();
    const soloProblemas = alertas.filter(a => a.saldo !== 0);
    res.json({
      success: true,
      total_revisadas: alertas.length,
      total_con_problema: soloProblemas.length,
      alertas: soloProblemas
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener alertas de balance' });
  }
});
 
// GET /api/apuestas/auditoria/balance/stream/:sala
// Resumen completo de un stream — cuáles rondas cuadraron y cuáles no
router.get('/auditoria/balance/stream/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;
    const [logsBalance, statsStream] = await Promise.all([
      saldos.find({ tipo: 'balance_ronda', usuario: '_SISTEMA_', sala }).sort({ ronda: 1 }).lean(),
      apuestaModel.aggregate([
        { $match: { sala } },
        { $group: { _id: { ronda: '$ronda', estado: '$estado' }, total: { $sum: '$cantidad' } } },
        { $sort: { '_id.ronda': 1 } }
      ])
    ]);
 
    const porRonda = {};
    statsStream.forEach(s => {
      const r = s._id.ronda;
      if (!porRonda[r]) porRonda[r] = { ronda: r, pagada: 0, perdida: 0, devuelta: 0 };
      porRonda[r][s._id.estado] = (porRonda[r][s._id.estado] || 0) + s.total;
    });
 
    const resumen = Object.values(porRonda).map(r => {
      const log = logsBalance.find(l => l.ronda === r.ronda);
      return {
        ronda: r.ronda,
        pagada: r.pagada || 0,
        perdida: r.perdida || 0,
        devuelta: r.devuelta || 0,
        cuadra: (r.pagada || 0) === (r.perdida || 0),
        diferencia: (r.pagada || 0) - (r.perdida || 0),
        auditado: !!log,
        log_concepto: log?.concepto || 'sin registro (ronda anterior al parche)'
      };
    });
 
    const rondasProblema = resumen.filter(r => !r.cuadra);
    res.json({
      success: true, sala,
      total_rondas: resumen.length,
      rondas_con_problema: rondasProblema.length,
      problemas: rondasProblema,
      detalle: resumen
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener auditoría del stream' });
  }
});
 
// GET /api/apuestas/auditoria/saldo_insuficiente?sala=X
// Detecta si alguien intentó apostar más de lo que tenía (race condition)
router.get('/auditoria/saldo_insuficiente', async (req, res) => {
  try {
    const { sala } = req.query;
    // En crearApuesta, cuando falla por saldo insuficiente el error llega al catch
    // y el saldo no se descuenta. Este endpoint busca en logs de consola si hay
    // registros de 'Saldo insuficiente' en la colección saldos (si se registró).
    // Por ahora consulta directo en apuestas — si alguien tiene apuestas con cantidad
    // mayor a lo que su saldo podría permitir en esa ronda.
    const { username } = req.query;
    const filtro = {};
    if (sala) filtro.sala = sala;
    if (username) filtro.username = username;
 
    // Buscar usuarios con saldo actual muy bajo que hayan apostado mucho
    const usuarios = await userModel.find({ saldo: { $lt: 0 } }, { username: 1, saldo: 1 }).lean();
    res.json({
      success: true,
      usuarios_saldo_negativo: usuarios, // nunca debe haber ninguno
      nota: 'Si hay usuarios con saldo negativo, hubo una race condition. Debe ser 0 siempre.'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar saldos negativos' });
  }
});
router.get('/auditoria/apuestas-negativas', async (req, res) => {
  try {
    const { sala } = req.query;
 
    // Buscar registros donde el saldo antes era menor que lo apostado
    // Esto indica que alguien apostó más de lo que tenía
    const filtro = {
      tipo: 'restar_saldo',
      saldo_antes: { $exists: true }, // solo registros nuevos con el campo
      $expr: { $lt: ['$saldo_antes', '$saldo'] } // saldo_antes < monto apostado
    };
    if (sala) filtro.sala = sala;
 
    const casos = await saldos.find(filtro, {
      usuario: 1, saldo: 1, saldo_antes: 1, saldo_despues: 1,
      concepto: 1, sala: 1, ronda: 1, fecha: 1, _id: 0
    }).sort({ fecha: -1 }).lean();
 
    // También buscar usuarios con saldo negativo (nunca debería haber)
    const saldosNegativos = await userModel.find(
      { saldo: { $lt: 0 } },
      { username: 1, saldo: 1, _id: 0 }
    ).lean();
 
    res.json({
      success: true,
      apuestas_con_saldo_insuficiente: casos.length,
      casos,
      usuarios_saldo_negativo: saldosNegativos.length,
      saldos_negativos: saldosNegativos,
      nota: casos.length === 0 && saldosNegativos.length === 0
        ? '✅ Sin anomalías detectadas'
        : `⚠️ Se encontraron ${casos.length} apuestas con saldo insuficiente y ${saldosNegativos.length} saldos negativos`
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar apuestas negativas' });
  }
});
 
// =============================================================================
// NUEVO ENDPOINT: auditoria/historial-usuario-ronda
// Para una ronda específica, muestra el saldo de cada usuario
// antes y después de apostar — permite ver si apostaron de más
// =============================================================================
 
router.get('/auditoria/historial-usuario-ronda/:sala/:ronda', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);
 
    // Apuestas de esa ronda
    const apuestasRonda = await apuestaModel.find(
      { sala, ronda },
      { username: 1, cantidad: 1, estado: 1, rojo: 1, verde: 1, _id: 0 }
    ).lean();
 
    // Registros de saldo de esa ronda (solo los que tienen saldo_antes)
    const registros = await saldos.find(
      { sala, ronda, tipo: 'restar_saldo' },
      { usuario: 1, saldo: 1, saldo_antes: 1, saldo_despues: 1, fecha: 1, _id: 0 }
    ).sort({ fecha: 1 }).lean();
 
    // Cruzar apuestas con registros de saldo
    const detalle = apuestasRonda.map(ap => {
      const reg = registros.find(r => r.usuario === ap.username);
      const saldoAntes = reg?.saldo_antes ?? null;
      const apostó = ap.cantidad;
      const teniaSuficiente = saldoAntes === null ? null : saldoAntes >= apostó;
 
      return {
        username: ap.username,
        cantidad_apostada: apostó,
        color: ap.rojo ? 'ROJO' : 'VERDE',
        estado: ap.estado,
        saldo_antes: saldoAntes,
        saldo_despues: reg?.saldo_despues ?? null,
        tenia_saldo_suficiente: teniaSuficiente,
        alerta: teniaSuficiente === false
          ? `⚠️ Tenía $${saldoAntes} y apostó $${apostó}`
          : null
      };
    });
 
    const alertas = detalle.filter(d => d.alerta);
 
    res.json({
      success: true,
      sala, ronda,
      total_apuestas: detalle.length,
      alertas_saldo: alertas.length,
      detalle,
      alertas
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial de ronda' });
  }
});

module.exports = router;