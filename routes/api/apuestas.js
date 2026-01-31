const router = require('express').Router();
const apuestaModel = require('../../models/apuestas.model');
const Screenshot = require('../../models/screenshot.model');
const userModel = require('../../models/user.model');
const eliminarCentavos = (monto) => Math.floor(monto); // 10.99 → 10

router.get('/obtenerapuestas', async (req, res) => {
  res.send("hola");
});

router.put('/repartirGanancias/:sala/:ronda/:ganador', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);
    const ganador = req.params.ganador.toLowerCase();
    const { ajustes } = req.body; // Se obtienen los ajustes del cuerpo de la petición

    if (ganador !== 'rojo' && ganador !== 'verde') {
      return res.status(400).json({ error: "El color ganador debe ser 'rojo' o 'verde'." });
    }
    const colorPerdedor = ganador === 'rojo' ? 'verde' : 'rojo';
    const queryPerdedores = {
      sala,
      ronda,
      estado: 'cazada',
      // Construir la query para encontrar al color opuesto
      ...(colorPerdedor === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' })
    };

    await apuestaModel.updateMany(queryPerdedores, { $set: { estado: 'perdida' } });

    // --- NUEVA LÓGICA CONDICIONAL ---
    // Si se proporcionan ajustes desde el frontend, se usa esta nueva lógica.
    if (ajustes && Array.isArray(ajustes) && ajustes.length > 0) {
      console.log(`[Repartir con Ajustes] Sala: ${sala}, Ronda: ${ronda}`);

      // Marcar todas las apuestas 'cazadas' de la ronda como 'pagadas' para consistencia.
      await apuestaModel.updateMany(
        { sala, ronda, estado: 'cazada' },
        { $set: { estado: 'pagada', fechaCierre: new Date() } }
      );

      let comisionBancaTotal = 0;

      // Procesar cada ajuste enviado desde el modal
      await Promise.all(ajustes.map(async (ajuste) => {
        const { username, totalAEntregar, apuestaOriginal } = ajuste;
        const montoFinal = eliminarCentavos(totalAEntregar);

        if (isNaN(montoFinal) || montoFinal < 0) {
          console.warn(`[Ajuste Inválido] Monto inválido para ${username}: ${totalAEntregar}`);
          return;
        }

        // La comisión se calcula sobre la apuesta original, no sobre el monto final ajustado.
        const comision = eliminarCentavos(Number(apuestaOriginal) * 0.1);
        comisionBancaTotal += comision;

        // Pagar al usuario el monto ajustado
        if (montoFinal > 0) {
          await userModel.findOneAndUpdate(
            { username },
            { $inc: { saldo: montoFinal } },
            { new: true }
          );
        }
      }));

      // Sumar la comisión total a la BANCA
      if (comisionBancaTotal > 0) {
        await userModel.findOneAndUpdate(
          { username: 'BANCA' },
          { $inc: { saldo: comisionBancaTotal } },
          { new: true }
        );
      }

      console.log(`[Repartir con Ajustes] Ganancias repartidas con ajustes manuales. Comisión total para BANCA: ${comisionBancaTotal}`);

    } else {
      // --- LÓGICA ORIGINAL (SIN CAMBIOS) ---
      // Si no vienen ajustes, se ejecuta el código que ya tenías.
      console.log(`[Repartir Original] Sala: ${sala}, Ronda: ${ronda}`);
      const apuestas = await apuestaModel.find({ sala, ronda, estado: 'cazada' });

      if (apuestas.length === 0) {
        return res.json({ message: "No hay apuestas cazadas para esta sala y ronda." });
      }

      const apuestasGanadoras = apuestas.filter(apuesta =>
        (ganador === 'rojo' && apuesta.rojo !== '') ||
        (ganador === 'verde' && apuesta.verde !== '')
      );

      if (apuestasGanadoras.length === 0) {
        return res.json({ message: "No hay apuestas ganadoras para este color." });
      }

      await Promise.all(apuestasGanadoras.map(async (apuesta) => {
        const { username, cantidad } = apuesta;
        const comisionBanca = (cantidad * 0.1);
        const montoGanado = (cantidad * 2) - comisionBanca;
        console.log("monto ganado: ", montoGanado)
        if (isNaN(montoGanado) || montoGanado <= 0) {
          console.warn(`Monto inválido para usuario ${username}: ${cantidad}`);
          return;
        }
        await userModel.findOneAndUpdate(
          { username },
          { $inc: { saldo: montoGanado } },
          { new: true }
        );
        await userModel.findOneAndUpdate(
          { username: 'BANCA' },
          { $inc: { saldo: comisionBanca } },
          { new: true }
        );
        await apuestaModel.findByIdAndUpdate(apuesta._id, {
          estado: 'pagada',
          cantidadOriginal: apuesta.cantidad,
          colorOriginal: apuesta.rojo ? 'rojo' : 'verde',
          fechaCierre: new Date()
        });
      }));
    }

    // --- CORRECCIÓN AUTOMÁTICA DE SALDOS (Se ejecuta en ambos casos) ---
    const [inicio, final] = await Promise.all([
      Screenshot.find({ sala, ronda, momento: 'inicio' }),
      Screenshot.find({ sala, ronda, momento: 'final' })
    ]);

    // Calcular resultado esperado por usuario (sigue la lógica existente)
    const apuestasRonda = await apuestaModel.find({ sala, ronda });
    const resultadoEsperadoPorUsuario = {};
    apuestasRonda.forEach(apuesta => {
      const username = apuesta.username || apuesta.usuario;
      const cantidad = Number(apuesta.cantidad) || 0;
      const estado = apuesta.estado;
      if (!username) return;
      if (!resultadoEsperadoPorUsuario[username]) resultadoEsperadoPorUsuario[username] = { resultadoNeto: 0 };
      if (estado === 'pagada') {
        resultadoEsperadoPorUsuario[username].resultadoNeto += cantidad * 0.9;
      } else if (estado === 'cazada') {
        resultadoEsperadoPorUsuario[username].resultadoNeto -= cantidad;
      } else if (estado === 'en_espera') {
        // dejar en espera: no afectar resultado hasta que se resuelva
        resultadoEsperadoPorUsuario[username].resultadoNeto += 0;
      }
    });

    // Comparar y corregir (operación atómica)
    for (const f of final) {
      const i = inicio.find(ini => ini.usuario === f.usuario);
      const saldoInicio = i?.saldo ?? 0;
      const diferenciaReal = Number(f.saldo) - Number(saldoInicio);
      const resultadoEsperado = resultadoEsperadoPorUsuario[f.usuario]?.resultadoNeto ?? 0;
      const discrepancia = diferenciaReal - resultadoEsperado;

      if (Math.abs(discrepancia) >= 0.01) {
        // aplicar ajuste atómico (equivalente a user.saldo -= discrepancia)
        try {
          const actualizado = await userModel.findOneAndUpdate(
            { username: f.usuario },
            { $inc: { saldo: -discrepancia } },
            { new: true }
          );

          if (actualizado) {
            // mostrar log con usuario y cantidad que se actualizó
            const ajusteAplicado = (-discrepancia); // lo que se sumó al saldo (positivo = aumento)
            console.log(`[AjusteSaldo] usuario=${actualizado.username} ajuste=${ajusteAplicado.toFixed(2)} nuevo_saldo=${Number(actualizado.saldo).toFixed(2)} sala=${sala} ronda=${ronda}`);
          } else {
            console.warn(`[AjusteSaldo] usuario no encontrado para ajuste: ${f.usuario} sala=${sala} ronda=${ronda} discrepancia=${discrepancia}`);
          }
        } catch (updErr) {
          console.error(`[AjusteSaldo] error al ajustar saldo de ${f.usuario}:`, updErr);
        }
      }
    }
    res.json({ success: "Ganancias repartidas exitosamente." });
  } catch (error) {
    console.error('Error al repartir ganancias:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});
router.get('/obtenerapuestasBySalaRonda/:sala/:ronda', async (req, res) => {
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
      const cantidadTotal = eliminarCentavos(apuestasPorUsuario[username]); //Aplicar el redondeo para la cantidad total de la apuesta 
      const user = await userModel.findOne({ username });
      if (user) {
        user.saldo += cantidadTotal;
        await user.save();
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
    console.log("apuestas por usuario:", apuestasPorUsuario);
    // Devolver las apuestas a los usuarios
    await Promise.all(Object.keys(apuestasPorUsuario).map(async (username) => {
      const cantidadTotal = eliminarCentavos(apuestasPorUsuario[username]); // Añadir redondeo
      const user = await userModel.findOne({ username });
      if (user) {
        user.saldo += cantidadTotal;
        await user.save();
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
    const { username, cantidad } = req.body;

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

router.get('/historial/:fecha/:ronda', async (req, res) => {
  try {
    const { fecha, ronda } = req.params;
    // Parse fecha (expecting DD-MM-YYYY)
    const parts = fecha.split('-');
    let startDate, endDate;
    if (parts.length === 3) {
      startDate = new Date(parts[2], parts[1] - 1, parts[0]);
      endDate = new Date(parts[2], parts[1] - 1, parts[0]);
      endDate.setHours(23, 59, 59, 999);
    } else {
      return res.status(400).json({ error: "Fecha invalida" });
    }

    const apuestas = await apuestaModel.find({
      fecha: { $gte: startDate, $lte: endDate },
      ronda: Number(ronda)
    });
    res.json(apuestas);

  } catch (error) {
    console.error('Error al obtener historial por fecha:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});
router.get('/historialPorRondas/:username', async (req, res) => {

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
router.get('/resumen-stream/:sala', async (req, res) => {
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

module.exports = router;