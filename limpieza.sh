#!/bin/bash

# Definir las carpetas cuyas contenidos se van a borrar
carpetas=(
  "uploads"
  "uploadsStreams"
  "uploadsMensajes"
   "uploadsUsers"
)

# Recorrer cada carpeta y borrar su contenido
for carpeta in "${carpetas[@]}"; do
  echo "Borrando contenido de la carpeta: $carpeta"
  rm -rf "$carpeta"/*
done

echo "Contenido de las carpetas borrado."
