const express = require('express');
const router = express.Router();

// --- Lógica de Mantenimiento ---

// En una aplicación real, este valor se guardaría en una base de datos.
// Por ahora, lo guardamos en una variable en memoria del servidor.
let appSettings = {
  maintenanceMode: false
};

/**
 * @route   GET api/settings/maintenance-status
 * @desc    Obtiene el estado actual del modo mantenimiento.
 * @access  Public
 */
router.get('/maintenance-status', (req, res) => {
  res.json({ maintenanceMode: appSettings.maintenanceMode });
});

/**
 * @route   POST api/settings/maintenance-status
 * @desc    Activa o desactiva el modo mantenimiento.
 * @access  Private (¡Debe ser protegido!)
 */
router.post('/maintenance-status', (req, res) => {
  const { maintenanceMode } = req.body;

  // --- ¡IMPORTANTE! ---
  // Aquí es donde debes añadir la seguridad.
  // Antes de cambiar el estado, verifica si el usuario que hace la petición es un administrador.
  // Por ejemplo: if (req.user.role !== 'admin') { return res.status(403).send('No autorizado'); }
  // Como no tengo tu sistema de usuarios, lo dejo como una nota.
  // ¡NO USAR EN PRODUCCIÓN SIN PROTEGER ESTE ENDPOINT!

  if (typeof maintenanceMode !== 'boolean') {
    return res.status(400).json({ message: 'El valor de maintenanceMode debe ser un booleano.' });
  }

  appSettings.maintenanceMode = maintenanceMode;

  console.log(`[SETTINGS] Modo de mantenimiento cambiado a: ${appSettings.maintenanceMode}`);
  res.json({
    message: `Modo de mantenimiento actualizado a ${appSettings.maintenanceMode}`,
    maintenanceMode: appSettings.maintenanceMode
  });
});

module.exports = router;