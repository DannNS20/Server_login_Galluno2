const router = require('express').Router();
const pm2 = require('pm2');

// Endpoint para reiniciar un proceso PM2 con un ID específico
router.post('/restart/:id', (req, res) => {
  const id = req.params.id;

  pm2.connect(err => {
    if (err) {
      console.error('Error connecting to PM2:', err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }

    pm2.restart(id, (err, proc) => {
      pm2.disconnect(); // Disconnects from PM2

      if (err) {
        console.error('Error restarting process:', err);
        return res.status(500).json({ error: 'Failed to restart process' });
      }

      res.json({ success: `Process with ID ${id} restarted successfully` });
    });
  });
});

module.exports = router;

