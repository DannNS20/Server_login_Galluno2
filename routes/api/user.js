const router = require('express').Router();
const bcrypt = require('bcryptjs');
const User = require('../../models/user.model');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const saldos = require('../../models/saldos.model');
const Apuesta = require('../../models/apuestas.model');

const eliminarCentavos = (monto) => Math.floor(monto); // 10.99 -> 10

const path = require('path');

const helperImg = (filePath,fileName,size= 100) => {
    return sharp(filePath)
        .resize(size,size)
        .toFile(`./imagenesUsers/${fileName}`);

}

const storage = multer.diskStorage({
    destination:(req, file,cb) =>{
        cb(null,'./uploadsUsers' )
    },
    filename:(req,file,cb) => {
        const ext = file.originalname.split('.').pop()
        cb(null, `${Date.now()}.png`)
    }

});
const upload = multer({storage
});

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

//POST /api/users/register
// router.post('/register' , async (req, res) => {

//     console.log(req.body);
//     try{
     
//         const userExists = await  User.findOne({username: req.body.username});
//         if (userExists){
//             return res.json("el nombre de uruario ya existe");
            
//         }
//         req.body.password = bcrypt.hashSync(req.body.password,12);
//         const user = await User.create(req.body);
//         console.log(user);
//         return res.json(user);
     
//     }    
//     catch(error){
//         res.json({error: error.message});
//     }
// });
router.put('/change-password', async (req, res) => {
    try {
        const { username, currentPassword, newPassword } = req.body;

        // Validar que se proporcionen todos los campos necesarios
        if (!username || !currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        // Buscar al usuario en la base de datos
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Verificar la contraseña actual
        const isMatch = bcrypt.compareSync(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }

        // Validar que la nueva contraseña sea diferente a la actual
        const isSamePassword = bcrypt.compareSync(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
        }

        // Encriptar la nueva contraseña
        const hashedPassword = bcrypt.hashSync(newPassword, 12);

        // Actualizar la contraseña del usuario
        user.password = hashedPassword;
        await user.save();

        res.json({ success: 'Contraseña cambiada exitosamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/register', upload.single('file'), async (req, res) => {
    try {
        // Proceso de registro
        const userExists = await User.findOne({ username: req.body.username });
        if (userExists) {
            return res.json({ data: "El nombre de usuario ya existe" });
        }

        req.body.password = bcrypt.hashSync(req.body.password, 12);

        let pathFinal = null;
        if (req.file) {
            await helperImg(req.file.path, `resize-${req.file.filename}`);
            const path = `resize-${req.file.filename}`;

            // Utilizamos split para obtener el nombre sin extensión y la extensión
            const [nombreSinExtension, extension] = path.split('.');

            // Construimos el nuevo nombre del archivo
            pathFinal = `${nombreSinExtension}.png`;
        }

        // Creamos el usuario con o sin imagen
        const newUser = User({
            username: req.body.username,
            password: req.body.password,
            image: pathFinal, // null si no hay imagen
            rol: req.body.tipoUsuario,
        });

        await newUser.save();
        return res.json({ data: "Usuario ingresado!" });

    } catch (error) {
        return res.json({ error: error.message });
    }
});

router.get('/get-image/:username', async (req, res) => {
    try {
        const username = req.params.username;

        // Buscar al usuario en la base de datos
        const user = await User.findOne({ username: username });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Obtener el nombre de la imagen del usuario
        const imageName = user.image;

        if (!imageName) {
            return res.status(404).json({ error: 'Imagen no encontrada para este usuario' });
        }

        // Construir la ruta completa al archivo de imagen
        const imagePath = path.join(__dirname, '../../' ,'imagenesUsers', imageName);
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


router.get('/register' , async (req, res) => {   
    res.json("registro");
 
});



//POST /api/users/login
router.post('/login' , async (req, res) => {

    const user = await User.findOne({username: req.body.username});
    
    if(!user){
        return res.json({error:'Usuario ingresado es incorrecto'});
    }
    if(user.rol === 'baneado'){
        return res.json({error:'Usuario ingresado es incorrecto'});
    }
    const eq = bcrypt.compareSync(req.body.password, user.password);

    if (!eq){
        return res.json({error:'constraseña incorrecta'});
    }
    
    res.json({success:'Login correcto', 
            token: createToken(user)});
});

router.get('/login' , async (req, res) => {   
    return res.json("login");
 
});

function createToken(user){
    const payload={
        username: user.username,
        rol:user.rol,
    }
    return payload;
    // return jwt.sign(payload,'caballos en vivo') //esto es por si se quiere seguridad
}

router.get('/get-all-users', async (req, res) => {
    try {
        const users = await User.find({}, { password: 0 }); // Exclude password from the response
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
   
});


router.put('/edit-user/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;
        const updatedData = req.body; // Los datos que deseas actualizar

        // Verificar si la nueva contraseña se proporciona y encriptarla si es así
        if (updatedData.password) {
            updatedData.password = bcrypt.hashSync(updatedData.newPassword, 12);
        }

        // Actualiza el usuario en la base de datos
        const updatedUser = await User.findByIdAndUpdate(
            { _id: updatedData._id }, // Puedes cambiarlo según la estructura de tu modelo
            updatedData,
            { new: true } // Para devolver el usuario actualizado
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ success: 'Usuario actualizado', user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.put('/edit-user-with-image/:username', upload.single('file'), async (req, res) => {
    try {
        const usernameParam = req.params.username;
        console.log(`Username param: ${usernameParam}`);
        
        if (req.file) {
            console.log(`File received: ${req.file}`);
            helperImg(req.file.path, `resize-${req.file.filename}`);
            const path = `resize-${req.file.filename}`;

            // Utilizamos split para obtener el nombre sin extensión y la extensión
            const [nombreSinExtension, extension] = path.split('.');
            console.log(`File split into name and extension: ${nombreSinExtension}, ${extension}`);

            // Construimos el nuevo nombre del archivo
            const pathFinal = `${nombreSinExtension}.png`;
            console.log(`Final file path: ${pathFinal}`);
            
            // Verificar si la nueva contraseña se proporciona y encriptarla si es así
            let updatedData;
            if (req.body.newPassword) {
                console.log(`Password received: ${req.body.newPassword}`);
                const newPassword = bcrypt.hashSync(req.body.newPassword, 12);
                updatedData = { username: req.body.username, password: newPassword, image: pathFinal };
                console.log(`Updated data with password: ${JSON.stringify(updatedData)}`);
            } else {
                updatedData = { username: req.body.username, image: pathFinal };
                console.log(`Updated data without password: ${JSON.stringify(updatedData)}`);
            }

            // Actualiza el usuario en la base de datos
            const updatedUser = await User.findByIdAndUpdate(
                { _id: req.body._id }, // Puedes cambiarlo según la estructura de tu modelo
                updatedData,
                { new: true } // Para devolver el usuario actualizado
            );
            console.log(`Updated user: ${updatedUser}`);

            if (!updatedUser) {
                console.log(`User not found with id: ${req.body._id}`);
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            res.json({ success: 'Usuario actualizado', user: updatedUser });
        } else {
            console.log('No file received');
            return res.status(400).json({ error: 'No file received' });
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// async function updateUsersRole() {
//     try {
//       const result = await User.updateMany({ rol: { $exists: false } }, { $set: { rol: 'usuario' } });
//       console.log(`Usuarios actualizados: ${result.nModified}`);
      
//     } catch (error) {
//       console.error('Error actualizando los usuarios:', error);
//     }
//   }

router.put('/ban-user/:username', async (req, res) => {
try {
    const usernameParam = req.params.username;
    console.log('baneando a ',usernameParam);
    // Encontrar y actualizar el rol del usuario
    const updatedUser = await User.findOneAndUpdate(
        { username: usernameParam },
        { $set: { rol: 'baneado' } },
        { new: true }
    );

    if (!updatedUser) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ success: 'Usuario baneado', user: updatedUser });
} catch (error) {
    res.status(500).json({ error: error.message });
}
});

router.put('/desban-user/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;
    
        // Encontrar y actualizar el rol del usuario
        const updatedUser = await User.findOneAndUpdate(
            { username: usernameParam },
            { $set: { rol: 'invitado' } },
            { new: true }
        );
    
        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
    
        res.json({ success: 'Usuario baneado', user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
    });

// GET /api/users/check-ban/:username
router.get('/check-ban/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;
        // Buscar al usuario en la base de datos
        const user = await User.findOne({ username: usernameParam });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Verificar si el usuario tiene el rol "baneado"
        if (user.rol == 'baneado') {
            return res.json({ isBanned: true });
        } else {
            return res.json({ isBanned: false });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.delete('/delete-user/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;
        const result = await User.deleteMany({ username: usernameParam });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'No se encontraron usuarios con ese nombre' });
        }

        res.json({ success: 'Usuarios borrado', deletedCount: result.deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/users/add-saldo/:username
router.put('/add-saldo/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;
        const { monto, concepto, tipo, sala } = req.body;  // Usar 'monto' en lugar de 'montoParam'

        // Validar que el monto sea un número positivo
        if (typeof monto !== 'number' || monto <= 0) {
            return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
        }

        // Buscar al usuario por su username
        const user = await User.findOne({ username: usernameParam });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Calcular el nuevo saldo
        const saldoNuevo = eliminarCentavos (user.saldo + monto);

        // Actualizar el saldo del usuario
        const updatedUser = await User.findOneAndUpdate(
            { username: usernameParam },
            { $set: { saldo: saldoNuevo } },
            { new: true }  // Para devolver el usuario actualizado
        );

        const saldo = new saldos({
            saldo: monto,
            fecha: new Date().toISOString(),
            usuario: usernameParam,
            tipo: tipo,
            concepto: concepto,
            sala: sala
        });

        await saldo.save();

        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const io = req.app.get('io');
        if (io) {
         io.to(usernameParam).emit('saldoActualizado', { saldo: updatedUser.saldo });
}

        // Respuesta de éxito con el saldo actualizado
        res.json({ success: 'Saldo actualizado', user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/users/subtract-saldo/:username
router.put('/subtract-saldo/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;
        const { monto, concepto, tipo = "restar_saldo", sala } = req.body;  // Usar 'monto' en lugar de 'montoParam'

        // Validar que el monto sea un número positivo
        if (typeof monto !== 'number' || monto <= 0) {
            return res.status(400).json({ error: 'La cantidad debe ser un número positivo' });
        }

        // Buscar al usuario por su username
        const user = await User.findOne({ username: usernameParam });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Validar que el usuario tenga suficiente saldo para restar
        if (user.saldo < monto) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }

        // Calcular el nuevo saldo
        const saldoNuevo = eliminarCentavos(user.saldo - monto); // <- NUEVA LÍNEA (Elimina los centavos de la recarga)

        // Actualizar el saldo del usuario
        const updatedUser = await User.findOneAndUpdate(
            { username: usernameParam },
            { $set: { saldo: saldoNuevo } },
            { new: true }  // Para devolver el usuario actualizado
        );
        const saldo = new saldos({
            saldo: monto,
            fecha: new Date().toISOString(),
            usuario: usernameParam,
            tipo: "restar_saldo",
            concepto: concepto,
            sala: sala
        });
        await saldo.save();
        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const io = req.app.get('io');
        if (io) {
        io.to(usernameParam).emit('saldoActualizado', { saldo: updatedUser.saldo });
}

        // Respuesta de éxito con el saldo actualizado
        res.json({ success: 'Saldo actualizado', user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-saldo/:username', async (req, res) => {
    try {
        const usernameParam = req.params.username;

        // Buscar al usuario en la base de datos
        const user = await User.findOne({ username: usernameParam });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Enviar el saldo del usuario
        res.json({ saldo: user.saldo });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
//Endpoint para cambio de foto
router.post('/change-profile-photo/:username', upload.single('file'), async (req, res) => {
    try {
        const username = req.params.username;
        
        // Verificar si se subió un archivo
        if (!req.file) {
            return res.status(400).json({ error: 'No se envió ninguna imagen' });
        }

        // Procesar la imagen usando el helper existente (tamaño 100x100 para foto de perfil)
        await helperImg(req.file.path, `resize-${req.file.filename}`, 100);
        const path = `resize-${req.file.filename}`;

        // Obtener nombre sin extensión y construir path final
        const [nombreSinExtension] = path.split('.');
        const pathFinal = `${nombreSinExtension}.png`;

        // Actualizar la foto del usuario en la base de datos
        const updatedUser = await User.findOneAndUpdate(
            { username },
            { image: pathFinal },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Respuesta exitosa
        res.json({ 
            success: true,
            message: 'Foto de perfil actualizada exitosamente',
            newPhotoUrl: pathFinal
        });

    } catch (error) {
        console.error('Error al cambiar la foto de perfil:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/get-users-by-stream/:codigoStream', async (req, res) => {
    try {
        const codigoStream = req.params.codigoStream;

        // 1. Usuarios que apostaron en el stream
        const apuestas = await Apuesta.find({ sala: { $regex: new RegExp(`^${codigoStream}$`, 'i') } });
        const usernamesApuestas = apuestas.map(a => a.username);

        // 2. Usuarios que tienen movimientos de saldo en el stream
        const saldosStream = await saldos.find({ sala: { $regex: new RegExp(`^${codigoStream}$`, 'i') } });
        const usernamesSaldos = saldosStream.map(s => s.usuario);

        // 3. Unir y dejar únicos
        const usernames = [...new Set([...usernamesApuestas, ...usernamesSaldos])];

        // 4. Buscar los usuarios por username
        const users = await User.find({ username: { $in: usernames } }, { password: 0 });

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;