const express = require('express');
const router = express.Router();
const Tabla = require('../../models/tabla.model');

const DEFAULTS = {
  title: 'TABLA DE PUNTOS',
  tablaData: [],
  rows: 9,
  cols: 9,
  cellColors: {},
    cellMarks: {}, // <-- almacenar marcas X/T
  palenqueName: 'PALENQUE LEÓN',
  entradaAmount: '$50,000.00',
  partyNames: []
};

async function getOrCreateDoc() {
  const doc = await Tabla.findOneAndUpdate(
    {},
    { $setOnInsert: DEFAULTS },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return doc;
}

router.get('/data', async (req, res) => {
  try {
    const doc = await getOrCreateDoc();
    return res.json({
      data: doc.tablaData,
      rows: doc.rows,
      cols: doc.cols,
      cellColors: doc.cellColors,
       cellMarks: doc.cellMarks,
      palenqueName: doc.palenqueName,
      entradaAmount: doc.entradaAmount,
      partyNames: doc.partyNames,
      title: doc.title
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/data', async (req, res) => {
  try {
    const payload = req.body || {};
    const update = {};

   if (Array.isArray(payload.data)) update.tablaData = payload.data;
    else if (Array.isArray(payload.tablaData)) update.tablaData = payload.tablaData;

    if (typeof payload.rows === 'number') update.rows = Math.max(1, Math.min(150, payload.rows));
    if (typeof payload.cols === 'number') update.cols = Math.max(3, Math.min(9, payload.cols));

if (payload.cellColors && typeof payload.cellColors === 'object') update.cellColors = payload.cellColors;
if (payload.cellMarks && typeof payload.cellMarks === 'object') update.cellMarks = payload.cellMarks; // <-- aceptar marcas
if (typeof payload.palenqueName === 'string') update.palenqueName = payload.palenqueName;
    if (typeof payload.entradaAmount === 'string') update.entradaAmount = payload.entradaAmount;
    if (Array.isArray(payload.partyNames)) update.partyNames = payload.partyNames;
    if (typeof payload.title === 'string') update.title = payload.title;

    const doc = await Tabla.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const io = req.app.get('io');
    if (io) {
      io.emit('tablaPuntosActualizada', {
        rows: doc.rows,
        cols: doc.cols,
        tablaData: doc.tablaData,
        cellColors: doc.cellColors,
        palenqueName: doc.palenqueName,
        cellMarks: doc.cellMarks,   // <-- emitir marcas a los clientes
        entradaAmount: doc.entradaAmount,
        partyNames: doc.partyNames,
        title: doc.title
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/title', async (req, res) => {
  try {
    const doc = await getOrCreateDoc();
    return res.json({ title: doc.title });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/title', async (req, res) => {
  try {
    const titulo = String(req.body.title || '');
    const doc = await Tabla.findOneAndUpdate(
      {},
      { $set: { title: titulo } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const io = req.app.get('io');
    if (io) io.emit('tablaPuntosActualizada', { title: doc.title });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const doc = await getOrCreateDoc();
    return res.json({
      rows: doc.rows,
      cols: doc.cols,
      palenqueName: doc.palenqueName,
      entradaAmount: doc.entradaAmount,
      partyNames: doc.partyNames
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;