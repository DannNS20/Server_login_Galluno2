const express = require("express");
require('dotenv').config();
require('./config/db');
const { initCron } = require('./services/email.service');

// Iniciar Cron
initCron();

const app = express();
const http = require('http').createServer(app); // Cambia aquí
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' } }); // Permite CORS para desarrollo

//CONFIG
const cors = require('cors');
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: false }));

// Haz disponible io en tus rutas
app.set('io', io);

//GET /api/
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => {
    res.send("holla");
});

// Manejo de conexiones de socket
io.on('connection', (socket) => {
    console.log('Usuario conectado por WebSocket');
    socket.on('join', (username) => {
        socket.join(username); // El usuario se une a una "room" con su username
    });
    socket.on('disconnect', () => {
        console.log('Usuario desconectado');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { // Cambia aquí
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});