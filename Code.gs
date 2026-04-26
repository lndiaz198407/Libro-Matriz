/**
 * ============================================================================
 *  Code.gs — AppScript del Sistema Libro Matriz
 * ============================================================================
 *  Autor: Diaz Luis
 *  Descripción: Script de Google Apps Script que vincula automáticamente
 *               los archivos PDF almacenados en carpetas de Google Drive
 *               con los registros de alumnos en la planilla de Google Sheets.
 *
 *  CÓMO FUNCIONA:
 *  1. Lee los IDs de las carpetas configuradas en 'carpetasConfig'.
 *  2. Escanea cada carpeta de Drive y arma un mapa { "M1-1": "ID_PDF" }.
 *  3. Recorre la planilla fila por fila y escribe el ID del PDF en col G.
 *  4. Al finalizar, escribe la fecha y hora actual en la celda H1.
 *     → Esa fecha es leída por el frontend (app.js) y mostrada en el badge
 *       de "Actualizado al..." en la cabecera del sistema web.
 *
 *  CÓMO EJECUTARLO:
 *  - Abrí el editor de AppScript (Extensiones → Apps Script).
 *  - Seleccioná la función "vincularTodosLosFolios" en el selector.
 *  - Hacé clic en "Ejecutar" (▶).
 *  - La primera vez pedirá permisos para acceder a Drive y Sheets: aceptá.
 * ============================================================================
 */

/**
 * Función principal: vincula folios de múltiples libros (M1, M2, M3, etc.)
 * usando los IDs de sus respectivas carpetas en Google Drive.
 * Al terminar, registra la fecha/hora de ejecución en la celda H1
 * para que el sistema web muestre cuándo fue la última actualización.
 */
function vincularTodosLosFolios() {

  // ==========================================================================
  // 1. CONFIGURACIÓN DE CARPETAS
  // ==========================================================================
  // Objeto que mapea el nombre del libro con el ID de su carpeta en Drive.
  // Para obtener el ID de una carpeta: abrí la carpeta en Drive y copiá
  // el fragmento de la URL después de "folders/".
  // Ejemplo URL: https://drive.google.com/drive/folders/1CIVEDUO5mV4gC4...
  //                                                      ↑ este es el ID
  //
  // Para agregar más libros, copiá el formato de una línea existente.
  var carpetasConfig = {
    "M1": "1CIVEDUO5mV4gC4byyhBxzv_r8ywx3aoR",
    "M2": "1_pX3HZ-Uk7LULIx--qkureYl7IebsZbs",
    "M3": "1CUI2kTH2o7AtPsiyEirsQrNihfAsFt6U",
    "M4": "ID_DE_CARPETA_M4"  // Reemplazá con el ID real cuando tengas la carpeta
  };

  // Referencia a la hoja activa de la planilla
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Lee todos los datos de la hoja en un array bidimensional.
  // datos[0] = fila 1, datos[1] = fila 2, etc.
  // datos[i][0] = columna A, datos[i][1] = columna B, etc.
  var datos = hoja.getDataRange().getValues();
  
  // ==========================================================================
  // 2. ESCANEO DE CARPETAS DE DRIVE
  // ==========================================================================
  // Mapa global donde acumulamos todos los archivos encontrados en Drive.
  // La clave tiene el formato "LIBRO-FOLIO" (ej: "M1-1", "M2-45").
  // El valor es el ID único del archivo en Google Drive.
  //
  // Usar un objeto como mapa permite búsquedas muy rápidas en el paso 3:
  // en lugar de recorrer miles de archivos por cada fila, buscamos
  // directamente por clave en O(1).
  var mapaGlobal = {};

  // Iteramos sobre cada libro configurado en carpetasConfig
  for (var prefijoLibro in carpetasConfig) {
    var idCarpeta = carpetasConfig[prefijoLibro];
    
    try {
      // Accedemos a la carpeta de Drive por su ID
      var carpeta = DriveApp.getFolderById(idCarpeta);
      
      // getFiles() devuelve un iterador (FileIterator) de todos los archivos
      var archivos = carpeta.getFiles();
      
      // Recorremos el iterador con hasNext() / next()
      while (archivos.hasNext()) {
        var arc = archivos.next();
        
        // Limpiamos el nombre del archivo para extraer solo el número.
        // Ejemplo: "001.pdf" → toLowerCase → "001.pdf"
        //          → replace(".pdf","") → "001"
        //          → trim() → "001"
        //          → parseInt(...,10) → 1
        //          → .toString() → "1"
        //
        // Esto normaliza nombres como "007.pdf", "7.pdf" o "07.pdf"
        // todos al mismo valor "7", que es lo que usamos como clave.
        var nombreLimpio = arc.getName().toLowerCase().replace(".pdf", "").trim();
        var numeroSolo = parseInt(nombreLimpio, 10).toString();
        
        // Construimos la clave única "LIBRO-NUMERO" y guardamos el ID del archivo
        var claveArchivo = prefijoLibro + "-" + numeroSolo;
        mapaGlobal[claveArchivo] = arc.getId();
      }

    } catch (e) {
      // Si el ID de carpeta es incorrecto o no tenemos acceso, lo registramos
      // en el log sin interrumpir el proceso para los demás libros.
      Logger.log("Error accediendo a la carpeta de " + prefijoLibro + ": " + e.message);
    }
  }


  // ==========================================================================
  // 3. VINCULACIÓN EN LA PLANILLA
  // ==========================================================================
  // Recorremos las filas de datos empezando desde la fila 2 (índice 1),
  // ya que la fila 1 (índice 0) es la cabecera de columnas.
  for (var i = 1; i < datos.length; i++) {
    
    // Leemos el Libro y el Folio de esta fila
    var libroExcel = datos[i][3].toString().trim().toUpperCase(); // Columna D: ej "M1"
    var folioExcel = datos[i][4].toString().trim();               // Columna E: ej "001"
    
    // Si alguna de las dos celdas está vacía, no hay nada que vincular en esta fila
    if (!libroExcel || !folioExcel) continue;

    // Normalizamos el número de folio igual que hicimos con los nombres de archivos
    // para que "001", "01" y "1" encuentren el mismo archivo en el mapa.
    var numeroFolioLimpio = parseInt(folioExcel, 10).toString();
    
    // Construimos la clave de búsqueda (debe coincidir con el formato del mapa)
    var claveBusqueda = libroExcel + "-" + numeroFolioLimpio;
    
    if (mapaGlobal[claveBusqueda]) {
      // ✅ Se encontró el archivo: escribimos su ID en la columna G
      // getRange(fila, columna): fila i+1 porque getRange usa base 1, columna 7 = G
      hoja.getRange(i + 1, 7).setValue(mapaGlobal[claveBusqueda]);

    } else if (carpetasConfig[libroExcel]) {
      // ⚠️ El libro está configurado pero el archivo no existe en esa carpeta.
      // Escribimos un mensaje descriptivo para identificar qué folios faltan.
      hoja.getRange(i + 1, 7).setValue("No encontrado en " + libroExcel);
    }
    // Si el libro NO está en carpetasConfig, simplemente no escribimos nada.
  }


  // ==========================================================================
  // 4. REGISTRO DE FECHA/HORA DE ACTUALIZACIÓN EN H1
  // ==========================================================================
  // Escribimos en la celda H1 la fecha y hora exacta en que se completó
  // este proceso. Esta celda cumple la función de "sello de tiempo" (timestamp).
  //
  // ¿Por qué H1?
  // - Las filas de datos empiezan en A2, por lo que H1 queda "fuera" de la
  //   tabla de alumnos y no interfiere con los datos.
  // - La API de Google Sheets del frontend lee específicamente H1 para
  //   mostrar el badge de "Actualizado al..." en la cabecera del sistema web.
  //
  // Formato de la fecha: podés cambiarlo a tu gusto.
  // Opciones comunes de Utilities.formatDate():
  //   "dd/MM/yyyy"          → 15/07/2025
  //   "dd/MM/yyyy HH:mm"    → 15/07/2025 14:30
  //   "dd 'de' MMMM yyyy"   → 15 de julio de 2025
  //
  // "America/Argentina/Buenos_Aires" es la zona horaria para Argentina (UTC-3).
  // Cambiá este valor si el sistema se usa en otra zona horaria.
  var ahora = new Date();
  var fechaFormateada = Utilities.formatDate(
    ahora,
    "America/Argentina/Buenos_Aires",
    "dd/MM/yyyy HH:mm"   // ← Modificá el formato aquí si querés otro estilo
  );

  // Escribimos la fecha en H1
  // getRange(1, 8) = fila 1, columna 8 = H
  hoja.getRange(1, 8).setValue(fechaFormateada);

  // Mostramos un mensaje de confirmación al operador que ejecutó el script
  SpreadsheetApp.getUi().alert(
    "✅ Proceso completado.\n\n" +
    "Se vincularon los folios disponibles.\n" +
    "Fecha de actualización registrada: " + fechaFormateada
  );
}
