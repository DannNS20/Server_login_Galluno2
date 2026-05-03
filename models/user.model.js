const {model, Schema} = require("mongoose");


const userSchema = new Schema({
    username: String,
    password: String,
    image: String,
    rol: String,
    saldo: { type: Number, default:0},
    
    creditoActivo: { type: Boolean, default: false } // Marca de "Usuario con crédito"
});


module.exports= model("user", userSchema);