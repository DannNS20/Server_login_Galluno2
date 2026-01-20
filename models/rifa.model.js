const mongoose = require('mongoose');

// Definimos el Schema de Venta
const VentaSchema = new mongoose.Schema({
  username: { type: String, required: true },
  numeros: { type: [Number], required: true },
  cantidad: { type: Number, required: true },
  room: { type: String, required: true },
  date: { type: Date, default: Date.now },
  rifa: { type: Number, required: true },
  estado: { type: String, default: 'activa' },
  precioUnitario: { type: Number, required: true }
});

// **CORRECCIÓN CLAVE**: Creamos el modelo 'Venta' aquí, antes de que se use.
const Venta = mongoose.model('Venta', VentaSchema);

// Ahora definimos el Schema de Rifa
const RifaSchema = new mongoose.Schema({
  numeroRifa: { type: Number, required: true, unique: true },
  estadoVentas: { type: Boolean, default: true },
  numerosVendidos: { 
    type: Map, 
    of: String,
    default: new Map() 
  },
  numerosDisponibles: { type: [Number], default: [] },
  ganador: { 
    numero: { type: Number, default: null },
    username: { type: String, default: null }
  },
  totalRecaudado: { type: Number, default: 0 },
  totalNumeros: { type: Number, required: true },
  precioNumero: { type: Number, required: true, min: 2 },
  room: { type: String, default: 'ALL' },
  fechaCreacion: { type: Date, default: Date.now },
  premio: { type: Number, default: 0 },
  banca: { type: Number, default: 0 }
});

// Método para convertir Map a objeto
RifaSchema.methods.toJSON = function() {
  const rifa = this.toObject();
  rifa.numerosVendidos = Object.fromEntries(rifa.numerosVendidos);
  return rifa;
};

// Este método ahora funcionará porque 'Venta' ya está definido arriba.
RifaSchema.methods.comprarNumeros = async function(username, numeros, precioUnitario) {
  if (!this.estadoVentas) {
    throw new Error('Las ventas están cerradas para esta rifa');
  }

  for (const numero of numeros) {
    if (!this.numerosDisponibles.includes(numero)) {
      throw new Error(`El número ${numero} no está disponible`);
    }
  }

  const cantidadTotal = numeros.length * precioUnitario;
  // Esta línea ya no dará error
  const venta = new Venta({
    username,
    numeros,
    cantidad: cantidadTotal,
    room: this.room,
    rifa: this.numeroRifa,
    precioUnitario
  });

  for (const numero of numeros) {
    this.numerosVendidos.set(numero.toString(), username);
    this.numerosDisponibles = this.numerosDisponibles.filter(n => n !== numero);
  }
  this.totalRecaudado += cantidadTotal;

  await venta.save();
  await this.save();

  return { venta, rifa: this };
};
// Método para cerrar ventas
RifaSchema.methods.cerrarVentas = async function() {
  this.estadoVentas = false;
  await this.save();
  return this;
};

// Método para seleccionar ganador
RifaSchema.methods.seleccionarGanador = async function(numeroGanador) {
  if (this.estadoVentas) {
    throw new Error('Debes cerrar las ventas primero');
  }

  // --- INICIO DE LA CORRECCIÓN ---
  // Convertimos el número a string ANTES de hacer la comprobación
  const numeroGanadorStr = numeroGanador.toString();

  // Usamos el string para la comprobación en el Mapa
  if (!this.numerosVendidos.has(numeroGanadorStr)) {
    throw new Error('El número ganador no fue vendido');
  }
  // --- FIN DE LA CORRECCIÓN ---

  this.ganador = {
    numero: numeroGanador,
    username: this.numerosVendidos.get(numeroGanadorStr) // Usamos el string aquí también
  };

  this.premio = this.totalRecaudado * 0.8;
  this.banca = this.totalRecaudado * 0.2;

  await this.save();
  return this;
};

module.exports = {
  Rifa: mongoose.model('Rifa', RifaSchema),
  Venta: mongoose.model('Venta', VentaSchema)
};