const express = require("express");
require('dotenv').config();
require('./config/db');
const { initCron } = require('./services/email.service');

// Iniciar Cron
initCron();

const app = express();
const http = require('http').createServer(app); // Cambia aquí
const { Server } = require('socket.io');
const io = new Server(http, {
    cors: {
        origin: [
            "https://www.quinielasgallisticas.com",
            "http://localhost:4200",
            "http://localhost:8100",
            "https://serverlogin.cheapserverhub.com"
        ],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
        credentials: true
    }
});

//CONFIG
const cors = require('cors');

// Configuración explícita de CORS
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            "https://www.quinielasgallisticas.com",
            "http://localhost:4200",
            "http://localhost:8100",
            "https://serverlogin.cheapserverhub.com"
        ];
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        } else {
            console.log('Bloqueado por CORS:', origin);
            return callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Habilitar pre-flight para todas las rutas

// Middleware para debug de headers
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
    console.log('Origin:', req.headers.origin);
    next();
});
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