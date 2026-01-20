const {model, Schema} = require("mongoose");


const userSchema = new Schema({
    username: String,
    password: String,
    image: String,
    rol: String,
    saldo: { type: Number, default:0},
});


module.exports= model("user", userSchema);