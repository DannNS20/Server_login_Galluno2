const router = require('express').Router();
const apuestaModel = require('../../models/apuestas.model');
const Screenshot = require('../../models/screenshot.model');
const userModel = require('../../models/user.model');
// NUEVO: modelo saldos para registrar movimientos y auditoría (igual que Plumass)
const saldos = require('../../models/saldos.model');
const eliminarCentavos = (monto) => Math.floor(monto); // 10.99 → 10

// =============================================================================
// HELPER: verificarBalanceRonda (igual que Plumass)
// Registra en la colección saldos si la ronda cuadra o tiene asimetría.
// NOTA: Galluno usa MongoDB 4.4 sin Replica Set — NO usamos conTransaccion
// con session porque requiere RS. Usamos operaciones atómicas $gte/$inc.
// =============================================================================
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

// =============================================================================
// MEJORADO: repartirGanancias — igual que Galluno original PERO con:
// 1. Protección doble pago (409 si ya hay pagadas)
// 2. for...of en serie en vez de Promise.all paralelo
// 3. Registro en modelo saldos
// 4. verificarBalanceRonda al final
// =============================================================================
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

    // NUEVO: Protección contra doble pago (igual que Plumass)
    const yaPagadas = await apuestaModel.countDocuments({ sala, ronda, estado: 'pagada' });
    if (yaPagadas > 0) {
      return res.status(409).json({
        error: `Esta ronda ya fue pagada (${yaPagadas} apuestas en estado pagada). No se puede pagar dos veces.`,
        yaPagada: true
      });
    }

    const queryPerdedores = {
      sala,
      ronda,
      estado: 'cazada',
      ...(colorPerdedor === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' })
    };
    await apuestaModel.updateMany(queryPerdedores, { $set: { estado: 'perdida' } });

    if (ajustes && Array.isArray(ajustes) && ajustes.length > 0) {
      console.log(`[Repartir con Ajustes] Sala: ${sala}, Ronda: ${ronda}`);

      await apuestaModel.updateMany(
        { sala, ronda, estado: 'cazada' },
        { $set: { estado: 'pagada', fechaCierre: new Date() } }
      );

      let comisionBancaTotal = 0;

      // MEJORADO: for...of en serie en vez de Promise.all
      for (const ajuste of ajustes) {
        const { username, totalAEntregar, apuestaOriginal } = ajuste;
        const montoFinal = eliminarCentavos(totalAEntregar);

        if (isNaN(montoFinal) || montoFinal < 0) {
          console.warn(`[Ajuste Inválido] Monto inválido para ${username}: ${totalAEntregar}`);
          continue;
        }

        const comision = eliminarCentavos(Number(apuestaOriginal) * 0.1);
        comisionBancaTotal += comision;

        if (montoFinal > 0) {
          await userModel.findOneAndUpdate(
            { username },
            { $inc: { saldo: montoFinal } },
            { new: true }
          );
        }
      }

      if (comisionBancaTotal > 0) {
        await userModel.findOneAndUpdate(
          { username: 'BANCA' },
          { $inc: { saldo: comisionBancaTotal } },
          { new: true }
        );
      }

      console.log(`[Repartir con Ajustes] Ganancias repartidas con ajustes manuales. Comisión total para BANCA: ${comisionBancaTotal}`);

    } else {
      console.log(`[Repartir Original] Sala: ${sala}, Ronda: ${ronda}`);

      const apuestasGanadoras = await apuestaModel.find({
        sala,
        ronda,
        estado: 'cazada',
        ...(ganador === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' })
      });

      if (apuestasGanadoras.length === 0) {
        return res.json({ message: "No hay apuestas ganadoras." });
      }

      // MEJORADO: for...of en serie en vez de Promise.all (igual que Plumass)
      for (const apuesta of apuestasGanadoras) {
        const { username, cantidad } = apuesta;
        const comisionBanca = eliminarCentavos(cantidad * 0.1);
        const montoGanado = eliminarCentavos((cantidad * 2) - comisionBanca);

        if (isNaN(montoGanado) || montoGanado <= 0) {
          console.warn(`Monto inválido para usuario ${username}: ${cantidad}`);
          continue;
        }

        await userModel.findOneAndUpdate(
          { username },
          { $inc: { saldo: montoGanado } },
          { new: true }
        );

        // ELIMINADO: registro en saldos tipo apuesta_ganada

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
      }
    }

    // ELIMINADA: corrección automática de saldos por screenshots (igual que Plumass)
    // NUEVO: verificar balance de la ronda
    await verificarBalanceRonda(sala, ronda);
    res.json({ success: "Ganancias repartidas exitosamente." });

  } catch (error) {
    console.error('Error al repartir ganancias:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.get('/obtenerapuestasBySalaRonda/:sala/:ronda',async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);
    const apuestas = await apuestaModel.find({ sala, ronda });
    if (apuestas.length === 0) {
      return res.json({});
    }
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
    const apuestas = await apuestaModel.find({ sala });
    if (apuestas.length === 0) {
      return res.json({});
    }
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
// NUEVO: POST /crearApuesta — endpoint atómico (igual que Plumass pero sin session)
// Descuenta saldo Y crea la apuesta en una operación. $gte garantiza atomicidad.
// Si saldo insuficiente → rechaza sin tocar nada.
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

    // PASO 1: Descontar saldo — solo si hay suficiente ($gte atómico, sin session)
    const userActualizado = await userModel.findOneAndUpdate(
      {
        username,
        saldo: { $gte: cantidadRedondeada }
      },
      {
        $inc: { saldo: -cantidadRedondeada },
        $set: { lastActivity: new Date() }
      },
      { new: true }
    );

    if (!userActualizado) {
      const userExiste = await userModel.findOne({ username }).lean();
      if (!userExiste) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      return res.status(400).json({
        error: `Saldo insuficiente. Saldo actual: $${userExiste.saldo}, apuesta: $${cantidadRedondeada}`,
        saldoActual: userExiste.saldo
      });
    }

    // PASO 2: Guardar la apuesta
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
    await nuevaApuesta.save();

    const saldoAntes = userActualizado.saldo + cantidadRedondeada;
    const saldoDespues = userActualizado.saldo;

    if (saldoAntes < cantidadRedondeada) {
      console.error(`[ALERTA SALDO] ${username} apostó $${cantidadRedondeada} teniendo $${saldoAntes}`);
    }

    // PASO 3: ELIMINADO registro en saldos tipo restar_saldo / Apuesta P{ronda}

    return res.json({
      success: true,
      apuestaId: nuevaApuesta._id,
      saldoRestante: userActualizado.saldo,
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
    const cantidad = eliminarCentavos(Number(req.body.cantidad));
    const newBet = new apuestaModel({
      username: req.body.username,
      rojo: req.body.rojo,
      verde: req.body.verde,
      cantidad: cantidad,
      fecha: req.body.date,
      sala: req.body.room,
      ronda: req.body.ronda,
      estado: req.body.estado || 'en_espera'
    });
    await newBet.save();
    console.log(newBet);
    return res.json({ data: "Apuesta ingresada!", apuestaId: newBet._id });
  } catch (error) {
    console.error('Error al procesar la solicitud POST:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================================================================
// MEJORADO: emparejarAtomico — mismo código que Galluno original PERO sin session
// (Galluno tiene MongoDB 4.4 sin RS — quitamos todas las referencias a session)
// La atomicidad se mantiene con findOneAndUpdate + condición estado='en_espera'
// =============================================================================
router.post('/emparejarAtomico', async (req, res) => {
  try {
    const { apuestaId, cantidadOriginal, room, ronda, colorBuscado, username } = req.body;
    const cantidadRestante = eliminarCentavos(Number(cantidadOriginal));

    if (!apuestaId || !cantidadOriginal || !room || !ronda || !colorBuscado) {
      return res.status(400).json({ error: 'Parámetros incompletos' });
    }

    const apuestasCazadas = [];
    let cantidadTotalCazada = 0;
    let cantidadPendiente = cantidadRestante;

    const queryColor = colorBuscado === 'rojo' ? { rojo: 'rojo' } : { verde: 'verde' };

    // Sin .session() — compatible con MongoDB 4.4 sin RS
    const apuestasCompatibles = await apuestaModel.find({
      ...queryColor,
      sala: room,
      ronda: ronda,
      estado: 'en_espera',
      _id: { $ne: apuestaId },
      username: { $ne: username }
    })
    .sort({ fecha: 1 })
    .lean();

    for (const apuestaCompatible of apuestasCompatibles) {
      if (cantidadPendiente <= 0) break;

      const cantidadACazar = Math.min(cantidadPendiente, apuestaCompatible.cantidad);

      // Actualización atómica — condición estado='en_espera' previene doble caza
      const apuestaActualizada = await apuestaModel.findOneAndUpdate(
        {
          _id: apuestaCompatible._id,
          estado: 'en_espera'
        },
        {
          $set: {
            estado: 'cazada',
            cantidad: cantidadACazar
          }
        },
        { new: true }
      );

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
        await nuevaApuestaRestante.save();
      }
    }

    if (cantidadTotalCazada > 0) {
      const apuestaOriginal = await apuestaModel.findById(apuestaId).lean();

      if (!apuestaOriginal) {
        return res.status(404).json({ error: 'Apuesta original no encontrada' });
      }

      if (apuestaOriginal.estado !== 'en_espera') {
        return res.status(409).json({
          error: 'La apuesta ya fue procesada por otro proceso',
          conflict: true
        });
      }

      const apuestaOriginalActualizada = await apuestaModel.findOneAndUpdate(
        {
          _id: apuestaId,
          estado: 'en_espera'
        },
        {
          $set: {
            estado: 'cazada',
            cantidad: cantidadTotalCazada
          }
        },
        { new: true }
      );

      if (!apuestaOriginalActualizada) {
        return res.status(409).json({
          error: 'La apuesta ya fue procesada por otro proceso',
          conflict: true
        });
      }

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
        await nuevaApuestaRestante.save();
      }
    }

    res.json({
      success: true,
      apuestasCazadas,
      cantidadTotalCazada,
      cantidadRestante: cantidadPendiente,
      fueCompletamenteCazada: cantidadPendiente === 0
    });

  } catch (error) {
    console.error('Error en emparejamiento atómico:', error);
    res.status(500).json({ error: 'Error al procesar el emparejamiento', details: error.message });
  }
});

router.delete('/borrarapuesta/:id', async (req, res) => {
  try {
    const apuestaId = req.params.id;
    const apuestaExistente = await apuestaModel.findById(apuestaId);
    if (!apuestaExistente) {
      return res.status(404).json({ error: 'apuesta no encontrado' });
    }
    //await apuestaModel.findByIdAndDelete(apuestaId);
    res.json({ apuesta: 'apuesta borrado exitosamente' });
  } catch (error) {
    console.error('Error al borrar el apuesta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

///EMPATE
// MEJORADO: usa $inc atómico en vez de user.save() (igual que Plumass) + registra en saldos
router.put('/devolverApuestas/:sala/:ronda', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);

    const apuestas = await apuestaModel.find({ sala, ronda, estado: { $nin: ['devuelta', 'pagada'] } });

    if (apuestas.length === 0) {
      return res.json({ message: "No hay apuestas para esta sala y ronda." });
    }

    const apuestasPorUsuario = apuestas.reduce((acc, apuesta) => {
      if (!acc[apuesta.username]) {
        acc[apuesta.username] = 0;
      }
      acc[apuesta.username] += apuesta.cantidad;
      return acc;
    }, {});

    await Promise.all(Object.keys(apuestasPorUsuario).map(async (username) => {
      const cantidadTotal = eliminarCentavos(apuestasPorUsuario[username]);
      if (cantidadTotal > 0) {
        // MEJORADO: $inc atómico en vez de user.save()
        await userModel.findOneAndUpdate(
          { username },
          { $inc: { saldo: cantidadTotal } }
        );
        // ELIMINADO: registro en saldos tipo saldo_devuelto por empate
      }
    }));

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
    await apuestaModel.findByIdAndUpdate(id, { estado });
    res.json({ message: "Estado de la apuesta actualizado exitosamente." });
  } catch (error) {
    console.error('Error al actualizar el estado de la apuesta:', error);
    res.status(500).json({ error: 'Error al actualizar el estado de la apuesta.' });
  }
});

// MEJORADO: usa $inc atómico en vez de user.save() + registra en saldos
router.put('/devolverApuestasEnEspera/:sala/:ronda', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);

    const apuestasEnEspera = await apuestaModel.find({ sala, ronda, estado: 'en_espera' });

    if (apuestasEnEspera.length === 0) {
      return res.json({ message: "No hay apuestas en espera para esta sala y ronda." });
    }

    const apuestasPorUsuario = apuestasEnEspera.reduce((acc, apuesta) => {
      if (!acc[apuesta.username]) {
        acc[apuesta.username] = 0;
      }
      acc[apuesta.username] += apuesta.cantidad;
      return acc;
    }, {});

    console.log("apuestas por usuario:", apuestasPorUsuario);

    await Promise.all(Object.keys(apuestasPorUsuario).map(async (username) => {
      const cantidadTotal = eliminarCentavos(apuestasPorUsuario[username]);
      if (cantidadTotal > 0) {
        // MEJORADO: $inc atómico en vez de user.save()
        await userModel.findOneAndUpdate(
          { username },
          { $inc: { saldo: cantidadTotal } }
        );
        // ELIMINADO: registro en saldos tipo saldo_devuelto por apuesta no cazada
      }
    }));

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
    const cantidadRedondeada = eliminarCentavos(cantidad);

    if (isNaN(cantidadRedondeada) || cantidadRedondeada <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }

    const updatedUser = await userModel.findOneAndUpdate(
      {
        username,
        saldo: { $gte: cantidadRedondeada }
      },
      { $inc: { saldo: -cantidadRedondeada } },
      { new: true }
    );

    if (!updatedUser) {
      const user = await userModel.findOne({ username });
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    res.json({ success: 'Saldo actualizado', user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/actualizarCantidadApuesta', async (req, res) => {
  try {
    const { id, cantidad } = req.body;
    const cantidadRedondeada = eliminarCentavos(cantidad);

    if (isNaN(cantidadRedondeada) || cantidadRedondeada <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }

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
    const cantidadRedondeada = eliminarCentavos(cantidad);

    if (isNaN(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
    }

    const updatedUser = await userModel.findOneAndUpdate(
      { username },
      { $inc: { saldo: cantidadRedondeada } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ success: 'Saldo aumentado exitosamente', user: updatedUser });
  } catch (error) {
    console.error('Error al aumentar el saldo del usuario:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/historialDetallado/:username', async (req, res) => {
  try {
    const username = req.params.username;

    const [usuario, apuestas] = await Promise.all([
      userModel.findOne({ username }).select('_id').lean(),
      apuestaModel.find({ username })
        .sort({ fecha: -1 })
        .select('_id fecha sala ronda cantidad rojo verde estado')
        .lean()
    ]);

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

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

router.get('/historialPorRondas/:username', async (req, res) => {
  try {
    const username = req.params.username;

    const [usuario, apuestas] = await Promise.all([
      userModel.findOne({ username }).select('username saldo').lean(),
      apuestaModel.find({ username })
        .sort({ fecha: -1 })
        .select('fecha sala ronda cantidad rojo verde estado')
        .lean()
    ]);

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

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

    const historial = Object.values(rondasColorMap)
      .map(rondaColor => {
        let cantidadFinal;
        let resultadoNeto;

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
        const fechaCompare = new Date(b.fecha) - new Date(a.fecha);
        if (fechaCompare !== 0) return fechaCompare;
        const rondaCompare = b.ronda - a.ronda;
        if (rondaCompare !== 0) return rondaCompare;
        if (a.color === 'ROJO' && b.color === 'VERDE') return -1;
        if (a.color === 'VERDE' && b.color === 'ROJO') return 1;
        return 0;
      });

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

    const apuestas = await apuestaModel.find({
      sala,
      rojo: 'rojo',
      estado: { $in: ['cazada', 'pagada', 'perdida', 'devuelta'] }
    });

    const totalPorRonda = apuestas.reduce((acc, apuesta) => {
      const ronda = apuesta.ronda || 0;
      if (!acc[ronda]) {
        acc[ronda] = 0;
      }
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
    const apuestas = await apuestaModel.find({ sala });

    if (apuestas.length === 0) {
      return res.json({});
    }

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

      apuestasAgrupadas[key].cantidadTotal += apuesta.cantidad;
      apuestasAgrupadas[key].numeroApuestas += 1;

      if (apuesta.rojo) apuestasAgrupadas[key].roja = apuesta.rojo;
      if (apuesta.verde) apuestasAgrupadas[key].verde = apuesta.verde;

      if (new Date(apuesta.fecha) > new Date(apuestasAgrupadas[key].fechaUltima)) {
        apuestasAgrupadas[key].fechaUltima = apuesta.fecha;
      }
    });

    const resultado = Object.values(apuestasAgrupadas)
      .sort((a, b) => {
        if (a.ronda !== b.ronda) {
          return b.ronda - a.ronda;
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

// =============================================================================
// NUEVOS ENDPOINTS DE AUDITORÍA (igual que Plumass, adaptados para Galluno)
// =============================================================================

// Resumen general de todos los streams
router.get('/resumen-general-streams', async (req, res) => {
  try {
    const resumen = await apuestaModel.aggregate([
      {
        $match: {
          estado: { $in: ['cazada', 'pagada', 'perdida'] },
          rojo: 'rojo'
        }
      },
      {
        $group: {
          _id: '$sala',
          totalApostado: { $sum: '$cantidad' }
        }
      },
      { $sort: { _id: 1 } },
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

// Balance de alertas
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

// Resumen completo de un stream
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

// Detecta saldos negativos
router.get('/auditoria/saldo_insuficiente', async (req, res) => {
  try {
    const usuarios = await userModel.find({ saldo: { $lt: 0 } }, { username: 1, saldo: 1 }).lean();
    res.json({
      success: true,
      usuarios_saldo_negativo: usuarios,
      nota: 'Si hay usuarios con saldo negativo, hubo una race condition. Debe ser 0 siempre.'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar saldos negativos' });
  }
});

// Detecta apuestas con saldo insuficiente
router.get('/auditoria/apuestas-negativas', async (req, res) => {
  try {
    const { sala } = req.query;

    const filtro = {
      tipo: 'restar_saldo',
      saldo_antes: { $exists: true },
      $expr: { $lt: ['$saldo_antes', '$saldo'] }
    };
    if (sala) filtro.sala = sala;

    const casos = await saldos.find(filtro, {
      usuario: 1, saldo: 1, saldo_antes: 1, saldo_despues: 1,
      concepto: 1, sala: 1, ronda: 1, fecha: 1, _id: 0
    }).sort({ fecha: -1 }).lean();

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

// Historial de usuario por ronda — muestra saldo antes/después de apostar
router.get('/auditoria/historial-usuario-ronda/:sala/:ronda', async (req, res) => {
  try {
    const sala = req.params.sala;
    const ronda = Number(req.params.ronda);

    const apuestasRonda = await apuestaModel.find(
      { sala, ronda },
      { username: 1, cantidad: 1, estado: 1, rojo: 1, verde: 1, _id: 0 }
    ).lean();

    const registros = await saldos.find(
      { sala, ronda, tipo: 'restar_saldo' },
      { usuario: 1, saldo: 1, saldo_antes: 1, saldo_despues: 1, fecha: 1, _id: 0 }
    ).sort({ fecha: 1 }).lean();

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
/**
 * GET /api/apuestas/resumen-usuarios-stream/:sala
 *
 * Calcula para cada usuario que participó en el stream:
 *   - saldoInicio:   snapshot del saldo justo ANTES de su primera apuesta en la sala
 *                    (saldo_antes del primer registro tipo 'restar_saldo' en saldos)
 *   - gana:          suma de apuestas con estado 'pagada' × 0.9 (comisión 10%)
 *   - pierde:        suma de apuestas con estado 'perdida'
 *   - depositos:     suma de saldos con tipo 'recarga' o 'deposito' en la sala
 *   - retiros:       suma de saldos con tipo 'retiro' o 'retiro_autorizado' en la sala
 *   - aumManual:     suma de saldos con tipo 'aumento_manual' o 'add_manual' en la sala
 *   - restaMan:      suma de saldos con tipo 'resta_manual' o 'subtract_manual' en la sala
 *   - tiene:         saldo actual del usuario (user.saldo)
 *   - deberiaTener:  saldoInicio + gana - pierde + depositos - retiros + aumManual - restaMan
 *   - tieneDeMas:    tiene - deberiaTener
 *   - aposto:        suma total apostada en la sala (todas las apuestas sin importar estado)
 *   - vaJugando:     suma de apuestas con estado 'cazada' (en juego ahora)
 *   - enEspera:      suma de apuestas con estado 'en_espera' (sin cazar aún)
 *   - devuelto:      suma de apuestas con estado 'devuelta'
 */
router.get('/resumen-usuarios-stream/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;
 
    // ── 1. Todas las apuestas del stream ──────────────────────────────────────
    const apuestas = await apuestaModel.find({ sala }).lean();
    if (apuestas.length === 0) {
      return res.json({ success: true, resumen: [] });
    }
 
    // ── 2. Todos los movimientos de saldo del stream ──────────────────────────
    const movimientos = await saldos.find({ sala }).lean();
 
    // ── 3. Usernames únicos que apostaron ─────────────────────────────────────
    const usernames = [...new Set(apuestas.map(a => a.username))];
 
    // ── 4. Saldos actuales de los usuarios ────────────────────────────────────
    const usuarios = await userModel.find(
      { username: { $in: usernames } },
      { username: 1, saldo: 1, _id: 0 }
    ).lean();
    const saldoActualMap = {};
    usuarios.forEach(u => { saldoActualMap[u.username] = u.saldo ?? 0; });
 
    // ── 5. Construir resumen por usuario ──────────────────────────────────────
    const resumenMap = {};
 
    usernames.forEach(username => {
      // Apuestas del usuario en este stream
      const apuestasUser = apuestas.filter(a => a.username === username);
 
      // Movimientos de saldo del usuario en este stream
      const movsUser = movimientos.filter(m => m.usuario === username);
 
      // SALDO INICIO: saldo_antes del primer 'restar_saldo' del stream
      // (justo antes de apostar por primera vez)
      const primeraApuesta = movsUser
        .filter(m => m.tipo === 'restar_saldo' && m.saldo_antes != null)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))[0];
      const saldoInicio = primeraApuesta ? (primeraApuesta.saldo_antes ?? 0) : 0;
 
      // GANA: apuestas pagadas × 0.9
      const gana = apuestasUser
        .filter(a => a.estado === 'pagada')
        .reduce((s, a) => s + Math.floor(a.cantidad * 0.9), 0);
 
      // PIERDE: apuestas perdidas
      const pierde = apuestasUser
        .filter(a => a.estado === 'perdida')
        .reduce((s, a) => s + a.cantidad, 0);
 
      // DEPÓSITOS: recargas aceptadas en el stream
      // Tipos que usa tu backend para depósitos/recargas:
      const depositos = movsUser
        .filter(m => ['recarga', 'deposito', 'recarga_aceptada', 'aumento_saldo'].includes(m.tipo))
        .reduce((s, m) => s + (m.saldo ?? 0), 0);
 
      // RETIROS: retiros autorizados en el stream
      const retiros = movsUser
        .filter(m => ['retiro', 'retiro_autorizado', 'retiro_procesado'].includes(m.tipo))
        .reduce((s, m) => s + (m.saldo ?? 0), 0);
 
      // AUMENTO MANUAL: lo que el admin agregó manualmente
      const aumManual = movsUser
        .filter(m => ['aumento_manual', 'add_manual', 'ajuste_positivo'].includes(m.tipo))
        .reduce((s, m) => s + (m.saldo ?? 0), 0);
 
      // RESTA MANUAL: lo que el admin restó manualmente
      const restaMan = movsUser
        .filter(m => ['resta_manual', 'subtract_manual', 'ajuste_negativo'].includes(m.tipo))
        .reduce((s, m) => s + (m.saldo ?? 0), 0);
 
      // TIENE: saldo actual en BD
      const tiene = saldoActualMap[username] ?? 0;
 
      // DEBERÍA TENER: proyección basada en todos los movimientos
      const deberiaTener = Math.floor(
        saldoInicio + gana - pierde + depositos - retiros + aumManual - restaMan
      );
 
      // TIENE DE MÁS: diferencia (negativo = le falta, positivo = le sobra)
      const tieneDeMas = tiene - deberiaTener;
 
      // APOSTÓ: total apostado en el stream (todas las apuestas)
      const aposto = apuestasUser.reduce((s, a) => s + a.cantidad, 0);
 
      // VA JUGANDO: lo que está cazado actualmente (en juego)
      const vaJugando = apuestasUser
        .filter(a => a.estado === 'cazada')
        .reduce((s, a) => s + a.cantidad, 0);
 
      // EN ESPERA: lo que no ha sido cazado aún
      const enEspera = apuestasUser
        .filter(a => a.estado === 'en_espera')
        .reduce((s, a) => s + a.cantidad, 0);
 
      // DEVUELTO: lo que se le devolvió (empate o apuesta sin cazar al cerrar)
      const devuelto = apuestasUser
        .filter(a => a.estado === 'devuelta')
        .reduce((s, a) => s + a.cantidad, 0);
 
      resumenMap[username] = {
        usuario: username,
        saldoInicio,
        gana,
        pierde,
        depositos,
        retiros,
        aumManual,
        restaMan,
        tiene,
        deberiaTener,
        tieneDeMas,
        aposto,
        vaJugando,
        enEspera,
        devuelto
      };
    });
 
    const resumen = Object.values(resumenMap).sort((a, b) => b.aposto - a.aposto);
 
    res.json({ success: true, resumen });
 
  } catch (error) {
    console.error('[resumen-usuarios-stream] Error:', error);
    res.status(500).json({ error: 'Error al calcular resumen de usuarios' });
  }
});

module.exports = router;