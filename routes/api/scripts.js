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

// Endpoint para reiniciar el contenedor de docker "server-stream-uno"
router.post('/restart-docker', (req, res) => {
  const { exec } = require('child_process');
  // Se busca el contenedor por nombre (asegurando coincidencia parcial o exacta según se requiera)
  // En este caso, usamos un filtro por nombre. Ojo: si el nombre es exacto usar name=^/server-stream-uno$ es mas seguro, 
  // pero el usuario menciono "server-stream-uno" en la captura.
  // El comando: docker restart $(docker ps -aqf "name=server-stream-uno")
  // O simplemente: docker restart server-stream-uno (si el nombre es unico y exacto)
  // Usaremos el filtro para ser mas flexibles si hay sufijos aleatorios como en dokploy a veces.

  // Comando mas robusto para dokploy que suele poner hash al final:
  // docker ps -q -f name=server-stream-uno | xargs --no-run-if-empty docker restart

  const command = 'docker ps -q -f name=server-stream-uno | xargs --no-run-if-empty docker restart';

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error restarting docker container: ${error.message}`);
      return res.status(500).json({ error: 'Failed to restart docker container', details: error.message });
    }
    if (stderr) {
      console.error(`Docker restart stderr: ${stderr}`);
      // Docker a veces manda mensajes informativos al stderr, no necesariamente es error fatal, pero lo logueamos.
    }
    console.log(`Docker restart stdout: ${stdout}`);
    res.json({ success: 'Docker stream restarted successfully', output: stdout });
  });
});

module.exports = router;

