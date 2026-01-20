const {model, Schema} = require("mongoose");


const recipeSchema = new Schema({
    username: String,
    monto:Number,
    image: String,
    fecha: {type: Date, default: Date.now},
    banco: { type: String },
    estado: {type: String, default: 'pendiente'},
    fechaAprobacion: { type: Date },    // <-- NUEVO CAMPO
    sala: { type: String }


});


module.exports= model("recipe", recipeSchema);