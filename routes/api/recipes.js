const router = require('express').Router();
const Recipe = require('../../models/recipe.model');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const accountSid = 'AC440e20d4cad728317506ac0f342a6bd4';
const authToken = 'c45cb9815f3ccb46e3e2eee0888fced1';
const client = twilio(accountSid, authToken);
const cron = require('node-cron');
const moment = require('moment-timezone');

// Tarea programada: cada 2 días a las 7:00 am hora centro de México
cron.schedule('0 7 */2 * *', async () => {
    try {
        console.log('Ejecutando limpieza automática de imágenes de recibos aceptados...');
        const recibosAprobados = await Recipe.find({ estado: 'aprobado', image: { $ne: null } });
        for (const recibo of recibosAprobados) {
            if (recibo.image) {
                const imagePath = path.join(__dirname, '../../imagenesRecipes', recibo.image);
                fs.unlink(imagePath, (err) => { });
                // Actualiza el campo image a null
                await Recipe.findByIdAndUpdate(recibo._id, { image: null });
            }
        }
        console.log('Limpieza automática de imágenes completada.');
    } catch (error) {
        console.error('Error en limpieza automática:', error);
    }
});

const helperImg = async (filePath, fileName, size = 100) => {
    console.log(`[DEBUG] helperImg: Iniciando procesamiento de imagen: ${fileName}`);
    try {
        const outputDir = path.join(__dirname, '../../imagenesRecipes');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPath = path.join(outputDir, fileName);

        await sharp(filePath)
            //.resize(size,size)
            .toFile(outputPath);

        console.log(`[DEBUG] helperImg: Imagen procesada guardada en ABIERTO: ${outputPath}`);
    } catch (error) {
        console.error(`[DEBUG] helperImg: Error procesando imagen ${fileName}:`, error);
        throw error;
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploadsRecipes');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = file.originalname.split('.').pop()
        cb(null, `${Date.now()}.png`)
    }

});
const upload = multer({
    storage
});

router.post('/upload', upload.single('file'), async (req, res) => {

    console.log('[DEBUG] /upload: Archivo recibido:', req.file);
    try {
        await helperImg(req.file.path, `resize-${req.file.filename}`)
        console.log('[DEBUG] /upload: helperImg completado');
    } catch (err) {
        console.error('[DEBUG] /upload: Error en helperImg:', err);
        return res.status(500).json({ error: 'Error procesando imagen' });
    }
    const path = `resize-${req.file.filename}`;

    // Utilizamos split para obtener el nombre sin extensión y la extensión
    const [nombreSinExtension, extension] = path.split('.');

    // Construimos el nuevo nombre del archivo
    const pathFinal = `${nombreSinExtension}.png`;

    res.send({ path: pathFinal })
});

router.post('/register', upload.single('file'), async (req, res) => {
    try {
        if (req.file) {
            console.log('[DEBUG] /register: Archivo recibido. Iniciando procesamiento...');
            await helperImg(req.file.path, `resize-${req.file.filename}`);
            console.log('[DEBUG] /register: helperImg completado.');
            const path = `resize-${req.file.filename}`;
            const [nombreSinExtension, extension] = path.split('.');
            const pathFinal = `${nombreSinExtension}.png`;

            const newRecipe = Recipe({
                username: req.body.username,
                monto: req.body.monto,
                image: pathFinal,
                banco: req.body.banco,
                sala: req.body.sala,
            });

            await newRecipe.save();

            // Emitir evento socket.io
            if (req.app.get('io')) {
                req.app.get('io').emit('nuevo_recibo', {
                    username: req.body.username,
                    monto: req.body.monto,
                    banco: req.body.banco,
                    sala: req.body.sala,
                    id: newRecipe._id,
                    fecha: new Date(),
                });
            }

            // LOG antes de enviar SMS
            console.log('Enviando SMS con Twilio...');
            console.log('De:', '+358454917775');
            console.log('Para:', '+525579920852');
            console.log('Mensaje:', `Nuevo Depósito\nCantidad: ${req.body.monto}\nUsuario: ${req.body.username}\nHora: ${new Date().toLocaleString()}\nBanco: ${req.body.banco}`);

            // Enviar SMS con Twilio
            client.messages.create({
                body: `Nuevo Depósito\nCantidad: ${req.body.monto}\nUsuario: ${req.body.username}\nHora: ${new Date().toLocaleString()}\nBanco: ${req.body.banco}`,
                from: '+358454917775', // Número de Twilio (remitente)
                to: '+525579920852'    // Número destino (con código de país)
            }).then(message => {
                console.log('SMS enviado correctamente. SID:', message.sid);
            }).catch(err => {
                console.error('Error enviando SMS:', err);
            });

            return res.json({ data: "Recibo ingresado!" });
        } else {
            return res.json({ data: "No se envio ninguna imagen" });
        }
    } catch (error) {
        return res.json({ error: error.message });
    }
});

router.get('/get-all-recipes', async (req, res) => {
    try {
        const Recipes = await Recipe.find({}).sort({ fecha: -1 }); // Sort by newest first
        res.json(Recipes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }

});

router.get('/debug-files', (req, res) => {
    const dirPath = path.join(__dirname, '../../imagenesRecipes');
    const parentDir = path.join(__dirname, '../../');

    console.log(`[DEBUG-ROUTING] CWD: ${process.cwd()}`);
    console.log(`[DEBUG-ROUTING] dirPath: ${dirPath}`);

    const response = {
        cwd: process.cwd(),
        dirPath: dirPath,
        parentDir: parentDir,
        serverUser: process.getuid ? process.getuid() : 'win',
        serverGroup: process.getgid ? process.getgid() : 'win',
        parentDirList: [],
        files: []
    };

    // Listar directorio padre para ver si existe la carpeta de imagenes
    try {
        response.parentDirList = fs.readdirSync(parentDir);
    } catch (err) {
        response.parentDirList = `Error listing parent: ${err.message}`;
    }

    fs.readdir(dirPath, (err, files) => {
        if (err) {
            response.error = err.message;
            return res.status(500).json(response);
        }
        // Devolver archivos y sus tamaños/fechas
        response.files = files.map(file => {
            try {
                const stats = fs.statSync(path.join(dirPath, file));
                return {
                    name: file,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime,
                    uid: stats.uid, // User ID del dueño
                    gid: stats.gid, // Group ID del dueño
                    mode: (stats.mode & 0o777).toString(8) // Permisos en octal (ej: 644)
                };
            } catch (err) {
                return { name: file, error: "No se pudo leer stats" };
            }
        });
        res.json(response);
    });
});

router.get('/get-image/:id', async (req, res) => {
    try {
        const id = req.params.id;

        // Validar formato de ID
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            console.error(`[ERROR] get-image: ID inválido: ${id}`);
            return res.status(400).json({ error: 'ID de recibo inválido' });
        }

        // Buscar al usuario en la base de datos
        const user = await Recipe.findOne({ _id: id });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Obtener el nombre de la imagen del usuario
        const imageName = user.image;

        if (!imageName) {
            console.error(`[ERROR] get-image: Campo 'image' es null/vacío para ID: ${id}`);
            return res.status(404).json({ error: 'Imagen no encontrada para este usuario' });
        }

        // Construir la ruta completa al archivo de imagen
        const imagePath = path.join(__dirname, '../../', 'imagenesRecipes', imageName);
        console.log(`[DEBUG][PID:${process.pid}] get-image: Solicitando imagen para usuario/recibo ID: ${id}`);
        console.log(`[DEBUG][PID:${process.pid}] get-image: Nombre de imagen en BD: ${imageName}`);
        console.log(`[DEBUG][PID:${process.pid}] get-image: Ruta completa resuelta: ${imagePath}`);

        if (!fs.existsSync(imagePath)) {
            console.error(`[ERROR][PID:${process.pid}] get-image: El archivo NO EXISTE en la ruta: ${imagePath}`);
            return res.status(404).json({ error: `Archivo físico no encontrado: ${imageName} en PID:${process.pid}` });
        } else {
            console.log(`[DEBUG][PID:${process.pid}] get-image: El archivo SÍ EXISTE.`);
        }

        // Enviar la imagen como respuesta
        res.sendFile(imagePath, {}, (err) => {
            if (err) {
                console.error(`[ERROR][PID:${process.pid}] get-image: Falló res.sendFile:`, err);
                if (!res.headersSent) {
                    return res.status(500).json({ error: 'Error al enviar el archivo: ' + err.message });
                }
            }
        });
    } catch (error) {
        console.error(`[CRITICAL ERROR][PID:${process.pid}] get-image:`, error);
        return res.status(500).json({ error: 'Error interno: ' + error.message });
    }
});

// Ruta para eliminar una receta por su _id
router.delete('/delete/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;

        // Buscar la receta en la base de datos
        const recipe = await Recipe.findById(recipeId);

        if (!recipe) {
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        // Obtener el nombre de la imagen asociada a la receta
        const imageName = recipe.image;

        // Construir la ruta completa del archivo de imagen
        const imagePath = path.join(__dirname, '../../imagenesRecipes', imageName);

        // Eliminar el archivo de imagen si existe
        fs.unlink(imagePath, (err) => {
            if (err && err.code !== 'ENOENT') {
                return res.status(500).json({ error: 'Error al eliminar la imagen' });
            }
        });

        // Eliminar la receta de la base de datos
        await Recipe.findByIdAndDelete(recipeId);

        return res.json({ message: 'Recibo eliminada exitosamente' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.put('/update-estado/:id', async (req, res) => {
    try {
        const { estado } = req.body;
        const recipeId = req.params.id;

        let updateFields = { estado };
        if (estado === 'aprobado') {
            updateFields.fechaAprobacion = new Date();
        }

        const recipe = await Recipe.findByIdAndUpdate(recipeId, updateFields, { new: true });
        if (!recipe) {
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }
        return res.json({ message: 'Estado actualizado', recipe });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.delete('/delete-all-aceptados', async (req, res) => {
    try {
        // Busca todos los recibos aprobados
        const recibosAprobados = await Recipe.find({ estado: 'aprobado' });

        // Elimina las imágenes asociadas a cada recibo aprobado
        for (const recibo of recibosAprobados) {
            if (recibo.image) {
                const imagePath = path.join(__dirname, '../../imagenesRecipes', recibo.image);
                fs.unlink(imagePath, (err) => {
                    // Ignora error si el archivo no existe
                });
            }
        }

        // Elimina los recibos aprobados de la base de datos
        const result = await Recipe.deleteMany({ estado: 'aprobado' });

        res.json({ message: 'Historial de recibos aceptados eliminado', deletedCount: result.deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.delete('/delete-all-rechazados', async (req, res) => {
    try {
        // Buscar todos los recibos rechazados
        const rechazados = await Recipe.find({ estado: 'rechazado' });

        // Eliminar las imágenes asociadas
        for (const recipe of rechazados) {
            if (recipe.image) {
                const imagePath = path.join(__dirname, '../../imagenesRecipes', recipe.image);
                fs.unlink(imagePath, (err) => {
                    // Ignorar error si el archivo no existe
                });
            }
        }

        // Eliminar los recibos rechazados de la base de datos
        await Recipe.deleteMany({ estado: 'rechazado' });

        return res.json({ message: 'Todos los recibos rechazados han sido eliminados.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Crear un recibo manual (sin imagen, solo datos)
router.post('/manual', async (req, res) => {
    try {
        const { username, monto, banco, estado, fecha, concepto } = req.body;

        // Validación básica
        if (!username || !monto || !banco || !estado || !fecha) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }

        // Crea el recibo manual (sin imagen)
        const newRecipe = new Recipe({
            username,
            monto,
            banco,
            estado,
            fecha,
            concepto,
            image: null // No hay imagen para recibos manuales
        });

        await newRecipe.save();

        // Emitir evento socket.io si aplica
        if (req.app.get('io')) {
            req.app.get('io').emit('nuevo_recibo_manual', {
                username,
                monto,
                banco,
                estado,
                fecha,
                concepto,
                id: newRecipe._id
            });
        }

        return res.json({ message: 'Recibo manual creado', recipe: newRecipe });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
module.exports = router;