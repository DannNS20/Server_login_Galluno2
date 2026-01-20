const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const Stream = require('./../../models/stream.model');
const fs = require('fs'); // Asegúrate de tener este import

const helperImg = (filePath,fileName,x=1280,y=720) => {
    return sharp(filePath)
        .resize(x,y)
        .toFile(path.join(__dirname, '../../imagenesStreams', fileName));

}

const helperImgOverlay = (filePath, fileName, x = 1280, y = 720) => {
    return sharp(filePath)
        .resize(x, y)
        .toFile(`./imagenesStreamsOverlay/${fileName}`); // Guarda en la carpeta correcta
}

const storage = multer.diskStorage({
    destination:(req, file,cb) =>{
        cb(null, path.join(__dirname, '../../uploadsStreams'))
    },
    filename:(req,file,cb) => {
        const ext = file.originalname.split('.').pop()
        cb(null, `${Date.now()}.png`)
    }

});
const upload = multer({storage}); // Aumenta el tamaño máximo de archivo a 50MB

router.post('/upload', upload.single('file'), (req, res) => {

    console.log(req.file);
    helperImg(req.file.path, `resize-${req.file.filename}`)
    const path = `resize-${req.file.filename}`;

// Utilizamos split para obtener el nombre sin extensión y la extensión
    const [nombreSinExtension, extension] = path.split('.');

// Construimos el nuevo nombre del archivo
    const pathFinal = `${nombreSinExtension}.png`;

    res.send({ path: pathFinal})
});

router.post('/setClave/:id', upload.single('file'), async (req, res) => {
    try {
        if (req.file) {
            console.log(req.file);
            helperImg(req.file.path, `resize-${req.file.filename}`);
            const path = `resize-${req.file.filename}`;

            // Utilizamos split para obtener el nombre sin extensión y la extensión
            const [nombreSinExtension, extension] = path.split('.');
            const esVIPvalue = req.body.esVIP === "true";
            // Construimos el nuevo nombre del archivo
            const pathFinal = `${nombreSinExtension}.png`;
            
            const id = req.params.id;
            const titulo = req.body.tituloStream;
            const clave = req.body.clave;
            const image = pathFinal;
            const esVIP = esVIPvalue;
            // Usamos findOneAndUpdate con upsert: true para crear un nuevo documento si no existe
            const registroActualizado = await Stream.findOneAndUpdate(
                { id },
                { titulo, clave, image, esVIP },
                { new: true, upsert: true }
            );

            return res.json({ data: "Stream Configurado!" });
        } else {
            // No se cargó ningún archivo
            return res.json({ data: "No se envio ningguna imagen" });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/getClave/:id', async (req, res) => {
    try {
        // Busca el stream con el ID igual a 1
        const idBuscado = req.params.id;
        const stream = await Stream.findOne({ id: idBuscado });

        // Si no se encuentra ningún stream con el ID igual a 1, devuelve un mensaje de error
        if (!stream) {
            return res.status(404).json({ error: 'Stream no encontrado' });
        }

        // Envía los datos del stream como respuesta
        res.send({
            stream: stream

        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.get('/getImagen/:id', async (req, res) => {
    try {
        // Busca el stream con el ID igual a 1
        const idBuscado = req.params.id;
        const stream = await Stream.findOne({ id: idBuscado });

        // Si no se encuentra ningún stream con el ID igual a 1, devuelve un mensaje de error
        if (!stream) {
            return res.status(404).json({ error: 'Stream no encontrado' });
        }

        // Construye la ruta del archivo de imagen
        const imagePath = path.join(__dirname, '../../imagenesStreams', stream.image);

        // Envía los datos del stream como respuesta
        res.sendFile(imagePath, {}, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Error al enviar el archivo' });
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// AGREGAR ESTA NUEVA RUTA:
router.get('/imagen-actual/:id', async (req, res) => {
    try {
        const idBuscado = req.params.id;
        const stream = await Stream.findOne({ id: idBuscado });

        if (!stream || !stream.image) {
            return res.json({ 
                hasImage: false, 
                imageUrl: null,
                timestamp: null 
            });
        }

        // Devolver la URL de la imagen actual
        res.json({
            hasImage: true,
            imageUrl: `/api/streams/getImagen/${idBuscado}`,
            timestamp: stream.updatedAt || new Date(),
            titulo: stream.titulo || ''
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// AGREGAR ESTA NUEVA RUTA ESPECÍFICA PARA IMAGEN DE STREAM:
router.post('/setImagenStream/:id', upload.single('file'), async (req, res) => {
    try {
        if (req.file) {
            console.log('Subiendo imagen de stream:', req.file);
            helperImg(req.file.path, `resize-${req.file.filename}`);
            const path = `resize-${req.file.filename}`;

            const [nombreSinExtension, extension] = path.split('.');
            const pathFinal = `${nombreSinExtension}.png`;
            
            const id = req.params.id;
            const titulo = req.body.tituloStream || 'Imagen de Stream';

            // Solo actualizar la imagen, manteniendo otros datos
            const registroActualizado = await Stream.findOneAndUpdate(
                { id },
                { 
                    image: pathFinal,
                    titulo: titulo,
                    // No tocar clave ni esVIP para no afectar el stream principal
                },
                { new: true, upsert: true }
            );

            console.log('Imagen de stream configurada');
            return res.json({ data: "Imagen de Stream Configurada!" });
        } else {
            return res.json({ data: "No se envió ninguna imagen" });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// NUEVA RUTA PARA QUITAR IMAGEN DE STREAM:
router.post('/removeImagenStream/:id', async (req, res) => {
    try {
        const id = req.params.id;
        
        // Solo limpiar la imagen, mantener otros datos
        const registroActualizado = await Stream.findOneAndUpdate(
            { id },
            { 
                $unset: { image: "" } // Eliminar solo el campo image
            },
            { new: true }
        );

        console.log('Imagen de stream removida');
        return res.json({ data: "Imagen de Stream Removida!" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// NUEVAS RUTAS PARA IMAGEN OVERLAY:
router.post('/setImagenOverlay/:id', upload.single('file'), async (req, res) => {
    try {
        console.log('Subiendo imagen overlay para:', req.params.id); // <-- Log para depuración
        if (req.file) {
            console.log('Detalles del archivo overlay:', req.file);
            helperImgOverlay(req.file.path, `overlay-${req.file.filename}`);
            const path = `overlay-${req.file.filename}`;

            const [nombreSinExtension, extension] = path.split('.');
            const pathFinal = `${nombreSinExtension}.png`;
            
            const id = req.params.id;
            const overlayId = `overlay-${id}`;
            const titulo = req.body.tituloStream || 'Imagen Overlay';

            const registroActualizado = await Stream.findOneAndUpdate(
                { id: overlayId },
                { 
                    id: overlayId,
                    image: pathFinal,
                    titulo: titulo,
                    clave: 'overlay',
                    esVIP: false
                },
                { new: true, upsert: true }
            );

            console.log('Imagen overlay configurada para:', overlayId);
            return res.json({ data: "Imagen Overlay Configurada!" });
        } else {
            return res.json({ data: "No se envió ninguna imagen" });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.post('/removeImagenOverlay/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const overlayId = `overlay-${id}`;
        const overlayStream = await Stream.findOne({ id: overlayId });

        // Elimina el archivo físico si existe
        if (overlayStream && overlayStream.image) {
            const imagePath = path.join(__dirname, '../../imagenesStreamsOverlay', overlayStream.image);
            fs.unlink(imagePath, (err) => {
                if (err) {
                    console.warn('No se pudo eliminar el archivo overlay:', imagePath, err.message);
                } else {
                    console.log('Archivo overlay eliminado:', imagePath);
                }
            });
        }

        // Elimina el registro de la base de datos
        await Stream.findOneAndDelete({ id: overlayId });

        console.log('Imagen overlay removida:', overlayId);
        return res.json({ data: "Imagen Overlay Removida!" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// NUEVA RUTA PARA CONSULTAR OVERLAY (PARA POLLING):
router.get('/imagen-overlay/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const overlayId = `overlay-${id}`; // overlay-1
        const overlayStream = await Stream.findOne({ id: overlayId });

        if (!overlayStream || !overlayStream.image) {
            return res.json({ 
                hasImage: false, 
                imageUrl: null,
                timestamp: null 
            });
        }

        // Agrega el timestamp como query param para evitar caché
        return res.json({
            hasImage: true,
            imageUrl: `/api/streams/getImagenOverlay/${overlayId}?t=${new Date(overlayStream.updatedAt).getTime()}`,
            timestamp: overlayStream.updatedAt || new Date(),
            titulo: overlayStream.titulo || ''
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// NUEVA RUTA PARA SERVIR IMAGEN OVERLAY:
router.get('/getImagenOverlay/:id', async (req, res) => {
    try {
        const overlayId = req.params.id; // overlay-1
        const overlayStream = await Stream.findOne({ id: overlayId });

        if (!overlayStream || !overlayStream.image) {
            return res.status(404).json({ error: 'Imagen overlay no encontrada' });
        }

        // CORRIGE AQUÍ:
        const imagePath = path.join(__dirname, '../../imagenesStreamsOverlay', overlayStream.image);

        // LOG para depuración
        console.log(`[GET OVERLAY] Solicitando imagen overlay para: ${overlayId}`);
        console.log(`[GET OVERLAY] Ruta completa del archivo: ${imagePath}`);

        res.sendFile(imagePath, {}, (err) => {
            if (err) {
                console.error(`[GET OVERLAY] Error al enviar archivo overlay: ${imagePath}`, err);
                return res.status(500).json({ error: 'Error al enviar archivo overlay' });
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// --- INICIO: REEMPLAZAR RUTAS DE VISIBILIDAD ---
router.post('/setVisibility/:id', async (req, res) => {
  try {
    const streamId = req.params.id;
    // Asegurarse de que el valor es un booleano
    const isVisible = req.body.visible === true || req.body.visible === 'true';

    console.log(`[BACKEND-POST] Solicitud para cambiar visibilidad de Stream ${streamId} a: ${isVisible}`);

    const updatedStream = await Stream.findOneAndUpdate(
      { id: streamId },
      { $set: { visible: isVisible } },
      { new: true, upsert: true } // new:true devuelve el doc actualizado, upsert:true lo crea si no existe
    );

    // Ahora updatedStream.visible no será undefined gracias a la corrección del modelo
    console.log(`[BACKEND-POST] Éxito. Stream ${streamId} ahora es visible: ${updatedStream.visible}`);
    res.json({ message: 'Visibilidad actualizada', stream: updatedStream });
  } catch (error) {
    console.error('[BACKEND-POST] Error al actualizar visibilidad:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// --- INICIO DE LA CORRECCIÓN ---
// Cambiamos el nombre de la ruta para evitar cualquier conflicto.
router.get('/check/:id', async (req, res) => {
// --- FIN DE LA CORRECCIÓN ---
  try {
    const streamId = req.params.id;
    console.log(`--- BACKEND-CHECK: ¡RUTA ALCANZADA! Buscando visibilidad para Stream ${streamId} ---`);

    // Busca el stream por su ID. select('visible') optimiza la consulta.
    const stream = await Stream.findOne({ id: streamId }).select('visible');

    if (!stream) {
      // Si el stream no existe en la BD, no es visible.
      console.log(`[BACKEND-CHECK] No se encontró registro para ${streamId}. Devolviendo visible: false.`);
      return res.json({ visible: false });
    }

    // El campo 'visible' existe gracias al 'default' en el modelo.
    // Devolvemos su valor booleano directamente.
    const isVisible = stream.visible === true;
    console.log(`[BACKEND-CHECK] Registro encontrado para ${streamId}. Devolviendo visible: ${isVisible}`);
    res.json({ visible: isVisible });

  } catch (error) {
    console.error('[BACKEND-CHECK] Error al obtener visibilidad:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
// --- FIN: REEMPLAZAR RUTAS DE VISIBILIDAD ---

module.exports = router;
