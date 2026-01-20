const {model, Schema} = require("mongoose");


const mesajeSchema = new Schema({
    username: String,
    contenido: String,
    sala: String,
    fecha: Date,
    image: { type: String, default:''},
});


module.exports= model("mensaje", mesajeSchema);