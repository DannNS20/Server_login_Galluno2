const router = require('express').Router();
const mensajeModel = require('../../models/mensaje.model');
const Mensaje = require('../../models/mensaje.model')
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const helperImg = (filePath, fileName, x = 300, y = 150) => {
  return sharp(filePath)
    //.resize(x,y)
    .toFile(`./imagenesMensajes/${fileName}`);

}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploadsMensajes')
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop()
    cb(null, `${Date.now()}.png`)
  }

});
const upload = multer({
  storage// Aumenta el tamaño máximo de archivo a 50MB
});

router.get('/obtenerMensajes', async (req, res) => {
  res.send("hola");
});


// router.get('/obtenerMensajesBySala/:sala', async (req, res) => {

//     try {
//       const sala = req.params.sala;

//       // Buscar todos los mensajes que coincidan con la sala
//       const mensajes = await mensajeModel.find({ sala });
//       console.log(mensajes);

//       // Devolver un objeto vacío si no se encuentran mensajes
//       const respuesta = mensajes.length > 0 ? mensajes : {};

//       res.json(respuesta);
//     } catch (error) {
//       console.error('Error al obtener mensajes por sala:', error);
//       res.status(500).json({ error: 'Error interno del servidor' });
//     }
//   });
router.get('/obtenerMensajesBySala/:sala', async (req, res) => {
  try {
    const sala = req.params.sala;
    // Buscar y ORDENAR por fecha para que lleguen en orden correcto
    const mensajes = await mensajeModel.find({ sala }).sort({ fecha: 1 });

    if (mensajes.length === 0) {
      return res.json({});
    }
    // Procesar todos los mensajes
    const mensajesConImagenes = await Promise.all(mensajes.map(async (mensaje) => {
      const mensajeObj = mensaje.toObject();
      // Crear objeto base con TODAS las fechas serializadas
      const mensajeFormateado = {
        _id: mensajeObj._id.toString(),
        username: mensajeObj.username,
        contenido: mensajeObj.contenido,
        message: mensajeObj.contenido, // Para compatibilidad con frontend
        image: mensajeObj.image || '',
        sala: mensajeObj.sala,
        // ¡¡¡IMPORTANTE!!! Serializar TODAS las fechas como strings
        fecha: mensajeObj.fecha ? mensajeObj.fecha.toISOString() : null,
        date: mensajeObj.fecha ? mensajeObj.fecha.toISOString() : null, // Duplicado como 'date'
        createdAt: mensajeObj.createdAt ? mensajeObj.createdAt.toISOString() : null,
        updatedAt: mensajeObj.updatedAt ? mensajeObj.updatedAt.toISOString() : null,
        // También enviar como timestamp numérico
        timestamp: mensajeObj.fecha ? mensajeObj.fecha.getTime() : null,
        // Debug info
        __debug: {
          hasFechaField: !!mensajeObj.fecha,
          fechaType: typeof mensajeObj.fecha,
          fechaValue: mensajeObj.fecha,
          fechaISO: mensajeObj.fecha ? mensajeObj.fecha.toISOString() : 'NO DATE'
        }
      };
      // Si hay imagen, ajustar el path
      if (mensajeObj.image) {
        try {
          const imagePath = path.join(__dirname, '../../imagenesMensajes', mensajeObj.image);
          // Verificar si el archivo existe
          const fs = require('fs');
          if (fs.existsSync(imagePath)) {
            mensajeFormateado.image = `/api/mensajes/get-image/${mensajeObj._id}`;
          }
        } catch (error) {
          console.error('Error procesando imagen:', error);
        }
      }
      return mensajeFormateado;
    }));
    res.json(mensajesConImagenes);
  } catch (error) {
    console.error('Error al obtener mensajes por sala:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

router.post('/enviarMensaje', async (req, res) => {
  try {
    let pathFinal = '';
    // Asegurarse de que la fecha sea un objeto Date válido
    let fechaMensaje = null;
    if (req.body.date) {
      // Si viene como string, intentar parsear
      fechaMensaje = new Date(req.body.date);
      if (isNaN(fechaMensaje.getTime())) {
        fechaMensaje = new Date();
      }
    } else {
      fechaMensaje = new Date();
    }
    // Construir el mensaje a guardar en la base de datos
    const newMessage = new mensajeModel({
      username: req.body.username,
      contenido: req.body.message,
      image: pathFinal,
      fecha: fechaMensaje,
      sala: req.body.room,
    });
    // Guardar el mensaje en la base de datos
    await newMessage.save();

    // Responder al cliente con éxito y el ID del mensaje y la fecha real
    return res.json({
      data: "Mensaje ingresado!",
      messageId: newMessage._id,
      fecha: newMessage.fecha ? newMessage.fecha.toISOString() : null // <-- AÑADE ESTO
    });
  } catch (error) {
    console.error('Error al procesar la solicitud POST:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
router.post('/enviarMensaje-with-image', upload.single('file'), async (req, res) => {
  try {
    let pathFinal = '';
    console.log('datos recibidos en el api:', req.body);
    // Verifica si se adjuntó un archivo
    if (req.file) {
      console.log(req.file);
      await helperImg(req.file.path, `resize-${req.file.filename}`);
      const path = `resize-${req.file.filename}`;

      // Utilizamos split para obtener el nombre sin extensión y la extensión
      const [nombreSinExtension, extension] = path.split('.');

      // Construimos el nuevo nombre del archivo
      pathFinal = `${nombreSinExtension}.png`;
    }

    // Construir el mensaje a guardar en la base de datos
    const newMessage = new mensajeModel({
      username: req.body.username,
      contenido: req.body.message,
      image: pathFinal,
      fecha: new Date(),
      sala: req.body.room,
    });

    // Guardar el mensaje en la base de datos
    await newMessage.save();
    console.log(newMessage);

    // Responder al cliente con éxito y el ID del mensaje
    return res.json({ data: "Mensaje ingresado!", messageId: newMessage._id });
  } catch (error) {
    console.error('Error al procesar la solicitud POST:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
router.delete('/borrarMensaje/:id', async (req, res) => {
  try {
    const mensajeId = req.params.id;

    // Verificar si el mensaje existe antes de intentar borrarlo
    const mensajeExistente = await mensajeModel.findById(mensajeId);
    if (!mensajeExistente) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }

    // Borrar el mensaje
    await mensajeModel.findByIdAndDelete(mensajeId);

    res.json({ mensaje: 'Mensaje borrado exitosamente' });
  } catch (error) {
    console.error('Error al borrar el mensaje:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/get-image/:id', async (req, res) => {
  try {
    const mensajeId = req.params.id;

    // Verificar si el mensaje existe antes de intentar borrarlo
    const mensajeExistente = await mensajeModel.findById(mensajeId);
    if (!mensajeExistente) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }

    // Obtener el nombre de la imagen del usuario
    const imageName = mensajeExistente.image;

    if (!imageName) {
      return res.status(404).json({ error: 'Imagen no encontrada para este usuario' });
    }

    // Construir la ruta completa al archivo de imagen
    const imagePath = path.join(__dirname, '../../', 'imagenesMensajes', imageName);
    console.log(imagePath);

    // Enviar la imagen como respuesta
    res.sendFile(imagePath, {}, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error al enviar el archivo' });
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
router.get('/get-image-path/:id', async (req, res) => {
  try {
    const mensajeId = req.params.id;

    // Verificar si el mensaje existe antes de intentar borrarlo
    const mensajeExistente = await mensajeModel.findById(mensajeId);
    if (!mensajeExistente) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }

    // Obtener el nombre de la imagen del usuario
    const imageName = mensajeExistente.image;

    if (!imageName) {
      return res.status(404).json({ error: 'Imagen no encontrada para este usuario' });
    }

    // Construir la ruta completa al archivo de imagen
    const imagePath = path.join(__dirname, '../../', 'imagenesMensajes', imageName);
    console.log(imagePath);

    // Enviar la imagen como respuesta
    res.send({ imagePath });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;