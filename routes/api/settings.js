const express = require('express');
const router = express.Router();
const Settings = require('../../models/settings.model');

/**
 * @route   GET api/settings/maintenance-status
 * @desc    Obtiene el estado actual del modo mantenimiento.
 */
router.get('/maintenance-status', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json({ maintenanceMode: settings.maintenanceMode });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

/**
 * @route   POST api/settings/maintenance-status
 * @desc    Activa o desactiva el modo mantenimiento.
 */
router.post('/maintenance-status', async (req, res) => {
  const { maintenanceMode } = req.body;

  if (typeof maintenanceMode !== 'boolean') {
    return res.status(400).json({ message: 'El valor de maintenanceMode debe ser un booleano.' });
  }

  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings({ maintenanceMode });
    } else {
      settings.maintenanceMode = maintenanceMode;
    }
    await settings.save();

    console.log(`[SETTINGS] Modo de mantenimiento cambiado a: ${settings.maintenanceMode}`);
    res.json({
      message: `Modo de mantenimiento actualizado a ${settings.maintenanceMode}`,
      maintenanceMode: settings.maintenanceMode
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

/**
 * @route   GET api/settings/title
 * @desc    Obtiene el título global del stream.
 */
router.get('/title', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json({ title: settings.streamTitle });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener título' });
  }
});

/**
 * @route   POST api/settings/title
 * @desc    Actualiza el título global del stream.
 */
router.post('/title', async (req, res) => {
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ message: 'El título es requerido.' });
  }

  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings({ streamTitle: title });
    } else {
      settings.streamTitle = title;
    }
    await settings.save();

    res.json({
      message: 'Título actualizado correctamente',
      title: settings.streamTitle
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar título' });
  }
});

module.exports = router;