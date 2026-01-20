const router = require('express').Router();
const Screenshot = require('../../models/screenshot.model');
const User = require('../../models/user.model');
const Apuesta = require('../../models/apuestas.model');
// Endpoint para registrar saldos (inicio/final de ronda)
router.post('/registrar-saldos', async (req, res) => {
  const { sala, ronda, momento } = req.body;

  // Validación básica - Fixed: Added sala validation
  if (!sala || !ronda || !momento) {
    return res.status(400).json({ error: 'Faltan campos requeridos (sala, ronda, momento)' });
  }
  
  if (!['inicio', 'final'].includes(momento)) {
    return res.status(400).json({ error: 'Momento invalido' });
  }
  
  try {
    const usuarios = await User.find({ saldo: { $gt: 0 } });
    
    // Check if users exist
    if (usuarios.length === 0) {
      return res.status(404).json({ mensaje: 'No hay usuarios con saldo mayor a 0' });
    }
    
    // Crear registros para cada usuario - Fixed: Changed usuario.usuario to usuario.username
    const operaciones = usuarios.map(usuario => {
      const screenshot = new Screenshot({
        usuario: usuario.username, // Fixed: Changed from usuario.usuario to usuario.username
        sala,
        ronda,
        saldo: usuario.saldo,
        momento,
        timestamp: new Date()
      });
      return screenshot.save();
    });

    await Promise.all(operaciones);
    res.status(201).json({ mensaje: 'Saldos registrados exitosamente', total: usuarios.length });
  } catch (error) {
    console.error('Error registrando saldos:', error); // Added error logging
    res.status(500).json({ error: 'Error en el servidor', detalle: error.message });
  }
});

// Endpoint para consultar saldos por ronda y momento
router.get('/consultar/:sala/:ronda/:momento', async (req, res) => {
  const {sala, ronda, momento } = req.params;

  try {
    const screenshots = await Screenshot.find({ sala, ronda, momento })
    res.json(screenshots);
  } catch (error) {
    res.status(500).json({ error: 'Error en la consulta' });
  }
});
//Para comparar los saldos de ganancias o perdidas 
router.get('/comparacion-completa/:codigoStream/:ronda', async (req, res) => {
  const { codigoStream, ronda } = req.params;

  try {
    // Obtener saldos de inicio y final de la ronda
    const [inicio, final] = await Promise.all([
      Screenshot.find({ sala: codigoStream, ronda, momento: 'inicio' }),
      Screenshot.find({ sala: codigoStream, ronda, momento: 'final' })
    ]);

    // Obtener todas las apuestas de esta sala y ronda
    const apuestas = await Apuesta.find({ sala: codigoStream, ronda });

    // Calcular resultado esperado por usuario
    const resultadoEsperadoPorUsuario = {};
    
    apuestas.forEach(apuesta => {
      const { username, cantidad, estado, rojo, verde } = apuesta;
      
      if (!resultadoEsperadoPorUsuario[username]) {
        resultadoEsperadoPorUsuario[username] = {
          totalCazado: 0,
          totalGanado: 0,
          totalPerdido: 0,
          comisionPagada: 0,
          resultadoNeto: 0
        };
      }
      
      // Sumar al total cazado solo si no es devuelta
      if (estado !== 'devuelta') {
        resultadoEsperadoPorUsuario[username].totalCazado += cantidad;
      }
      
      if (estado === 'pagada') {
        // Apuesta ganada: ganancia neta (cantidad * 1.9) - comisión ya descontada
        const gananciaNeta = cantidad * 0.9; // 90% después de comisión
        const comision = cantidad * 0.1; // 10% de comisión
        resultadoEsperadoPorUsuario[username].totalGanado += gananciaNeta;
        resultadoEsperadoPorUsuario[username].comisionPagada += comision;
        resultadoEsperadoPorUsuario[username].resultadoNeto += gananciaNeta;
      } else if (estado === 'devuelta') {
        // Empate: se devuelve lo apostado
        resultadoEsperadoPorUsuario[username].resultadoNeto += 0; // No gana ni pierde
      } else if (estado === 'cazada' || estado === 'en_espera') {
        // Apuesta perdida o en espera: pierde lo apostado
        resultadoEsperadoPorUsuario[username].totalPerdido += cantidad;
        resultadoEsperadoPorUsuario[username].resultadoNeto -= cantidad;
      }
    });

    const response = {
      comparaciones: final.map(f => {
        const i = inicio.find(ini => ini.usuario === f.usuario);
        const diferenciaReal = f.saldo - (i?.saldo || 0);
        
        // Obtener resultado esperado para este usuario
        const resultadoEsperado = resultadoEsperadoPorUsuario[f.usuario] || {
          totalCazado: 0,
          totalGanado: 0,
          totalPerdido: 0,
          comisionPagada: 0,
          resultadoNeto: 0
        };
        
        // Calcular la discrepancia
        const discrepancia = diferenciaReal - resultadoEsperado.resultadoNeto;
        
        // Determinar qué mostrar en "Gana/Pierde"
        let ganaPierde;
        if (Math.abs(discrepancia) < 0.01) { // Tolerancia para errores de redondeo
          // Coincide exactamente
          ganaPierde = "0";
        } else {
          // Hay discrepancia, mostrar la cantidad de más o de menos
          ganaPierde = (discrepancia >= 0 ? '+' : '') + discrepancia;
        }
        
        return {
          usuario: f.usuario,
          saldoInicio: i?.saldo || 0,
          saldoFinal: f.saldo,
          "Gana/Pierde": ganaPierde,
          diferencia: diferenciaReal,
          resultadoEsperado: resultadoEsperado.resultadoNeto,
          totalCazado: resultadoEsperado.totalCazado,
          totalGanado: resultadoEsperado.totalGanado,
          totalPerdido: resultadoEsperado.totalPerdido,
          comisionPagada: resultadoEsperado.comisionPagada,
          discrepancia: discrepancia,
          timestampInicio: i?.timestamp || null,
          timestampFinal: f.timestamp
        };
      }),
      metadata: {
        totalInicio: inicio.reduce((sum, item) => sum + item.saldo, 0),
        totalFinal: final.reduce((sum, item) => sum + item.saldo, 0),
        totalApuestas: apuestas.length,
        usuariosConApuestas: Object.keys(resultadoEsperadoPorUsuario).length
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error en la comparación:', error);
    res.status(500).json({ error: 'Error en la comparación' });
  }
});
// Endpoint para obtener todas las comparaciones de todas las rondas de un stream
router.get('/comparaciones-por-stream/:codigoStream', async (req, res) => {
  const { codigoStream } = req.params;

  try {
    // Obtener todas las rondas distintas para ese stream
    const rondas = await Screenshot.distinct('ronda', { sala: codigoStream });

    let todasComparaciones = [];

    for (const ronda of rondas) {
      // Reutiliza tu lógica de comparación por ronda
      const [inicio, final] = await Promise.all([
        Screenshot.find({ sala: codigoStream, ronda, momento: 'inicio' }),
        Screenshot.find({ sala: codigoStream, ronda, momento: 'final' })
      ]);

      // Obtener todas las apuestas de esta sala y ronda
      const apuestas = await Apuesta.find({ sala: codigoStream, ronda });

      // Calcular resultado esperado por usuario
      const resultadoEsperadoPorUsuario = {};
      apuestas.forEach(apuesta => {
        const { username, cantidad, estado } = apuesta;
        if (!resultadoEsperadoPorUsuario[username]) {
          resultadoEsperadoPorUsuario[username] = {
            totalCazado: 0,
            totalGanado: 0,
            totalPerdido: 0,
            comisionPagada: 0,
            resultadoNeto: 0
          };
        }
        if (estado !== 'devuelta') {
          resultadoEsperadoPorUsuario[username].totalCazado += cantidad;
        }
        if (estado === 'pagada') {
          const gananciaNeta = cantidad * 0.9;
          const comision = cantidad * 0.1;
          resultadoEsperadoPorUsuario[username].totalGanado += gananciaNeta;
          resultadoEsperadoPorUsuario[username].comisionPagada += comision;
          resultadoEsperadoPorUsuario[username].resultadoNeto += gananciaNeta;
        } else if (estado === 'devuelta') {
          resultadoEsperadoPorUsuario[username].resultadoNeto += 0;
        } else if (estado === 'cazada' || estado === 'en_espera') {
          resultadoEsperadoPorUsuario[username].totalPerdido += cantidad;
          resultadoEsperadoPorUsuario[username].resultadoNeto -= cantidad;
        }
      });

      // Genera comparaciones para esta ronda
      const comparacionesRonda = final.map(f => {
        const i = inicio.find(ini => ini.usuario === f.usuario);
        const diferenciaReal = f.saldo - (i?.saldo || 0);
        const resultadoEsperado = resultadoEsperadoPorUsuario[f.usuario] || {
          totalCazado: 0,
          totalGanado: 0,
          totalPerdido: 0,
          comisionPagada: 0,
          resultadoNeto: 0
        };
        const discrepancia = diferenciaReal - resultadoEsperado.resultadoNeto;
        let ganaPierde;
        if (Math.abs(discrepancia) < 0.01) {
          ganaPierde = "0";
        } else {
          ganaPierde = (discrepancia >= 0 ? '+' : '') + discrepancia;
        }
        return {
          usuario: f.usuario,
          saldoInicio: i?.saldo || 0,
          saldoFinal: f.saldo,
          "Gana/Pierde": ganaPierde,
          diferencia: diferenciaReal,
          resultadoEsperado: resultadoEsperado.resultadoNeto,
          totalCazado: resultadoEsperado.totalCazado,
          totalGanado: resultadoEsperado.totalGanado,
          totalPerdido: resultadoEsperado.totalPerdido,
          comisionPagada: resultadoEsperado.comisionPagada,
          discrepancia: discrepancia,
          timestampInicio: i?.timestamp || null,
          timestampFinal: f.timestamp,
          ronda
        };
      });

      todasComparaciones = todasComparaciones.concat(comparacionesRonda);
    }

// Agrupar por usuario para obtener el saldo inicial y final correctos
const agrupadoPorUsuario = {};

todasComparaciones.forEach(comp => {
  const usuario = comp.usuario;
  if (!agrupadoPorUsuario[usuario]) {
    agrupadoPorUsuario[usuario] = {
      ...comp,
      saldoInicio: comp.saldoInicio,
      saldoFinal: comp.saldoFinal,
      timestampInicio: comp.timestampInicio,
      timestampFinal: comp.timestampFinal,
      diferencia: comp.saldoFinal - comp.saldoInicio,
      resultadoEsperado: comp.resultadoEsperado,
      totalCazado: comp.totalCazado,
      totalGanado: comp.totalGanado,
      totalPerdido: comp.totalPerdido,
      comisionPagada: comp.comisionPagada,
      discrepancia: comp.discrepancia,
      rondas: [comp.ronda]
    };
  } else {
    // Saldo inicial: el menor timestampInicio
    if (comp.timestampInicio && (!agrupadoPorUsuario[usuario].timestampInicio || comp.timestampInicio < agrupadoPorUsuario[usuario].timestampInicio)) {
      agrupadoPorUsuario[usuario].saldoInicio = comp.saldoInicio;
      agrupadoPorUsuario[usuario].timestampInicio = comp.timestampInicio;
    }
    // Saldo final: el mayor timestampFinal
    if (comp.timestampFinal && (!agrupadoPorUsuario[usuario].timestampFinal || comp.timestampFinal > agrupadoPorUsuario[usuario].timestampFinal)) {
      agrupadoPorUsuario[usuario].saldoFinal = comp.saldoFinal;
      agrupadoPorUsuario[usuario].timestampFinal = comp.timestampFinal;
    }
    // Suma de totales
    agrupadoPorUsuario[usuario].resultadoEsperado += comp.resultadoEsperado;
    agrupadoPorUsuario[usuario].totalCazado += comp.totalCazado;
    agrupadoPorUsuario[usuario].totalGanado += comp.totalGanado;
    agrupadoPorUsuario[usuario].totalPerdido += comp.totalPerdido;
    agrupadoPorUsuario[usuario].comisionPagada += comp.comisionPagada;
    agrupadoPorUsuario[usuario].discrepancia += comp.discrepancia;
    agrupadoPorUsuario[usuario].rondas.push(comp.ronda);
  }
});

// Recalcula la diferencia y gana/pierde para cada usuario agrupado
const comparacionesAcumuladas = Object.values(agrupadoPorUsuario).map(comp => {
  const diferencia = comp.saldoFinal - comp.saldoInicio;
  let ganaPierde;
  if (Math.abs(comp.discrepancia) < 0.01) {
    ganaPierde = "0";
  } else {
    ganaPierde = (comp.discrepancia >= 0 ? '+' : '') + comp.discrepancia;
  }
  return {
    usuario: comp.usuario,
    saldoInicio: comp.saldoInicio,
    saldoFinal: comp.saldoFinal,
    "Gana/Pierde": ganaPierde,
    diferencia: diferencia,
    resultadoEsperado: comp.resultadoEsperado,
    totalCazado: comp.totalCazado,
    totalGanado: comp.totalGanado,
    totalPerdido: comp.totalPerdido,
    comisionPagada: comp.comisionPagada,
    discrepancia: comp.discrepancia,
    timestampInicio: comp.timestampInicio,
    timestampFinal: comp.timestampFinal
  };
});
    res.json({ comparaciones: todasComparaciones });
  } catch (error) {
    console.error('Error en comparaciones por stream:', error);
    res.status(500).json({ error: 'Error en la comparación por stream' });
  }
});
module.exports = router;