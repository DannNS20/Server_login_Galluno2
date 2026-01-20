const mongoose = require('mongoose');
require('dotenv').config();
const URI = process.env.MONGOOSE || 'mongodb://localhost:27017/users';
//mongoose.connect('mongodb+srv://dayronpc24:24191308@cluster0.k3sv0ty.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
mongoose.connect(URI);
