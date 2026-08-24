/**
 * ============================================================================
 *  app.js — Lógica principal del Sistema Libro Matriz
 * ============================================================================
 *  Autor: Diaz Luis
 *  Descripción: Maneja autenticación, consulta a la API de Google Sheets,
 *               filtrado de datos, ordenamiento, paginación y renderizado
 *               dinámico de resultados (tabla y tarjetas).
 *
 *  FLUJO GENERAL DE LA APLICACIÓN:
 *  1. El usuario abre la página → ve la pantalla de login.
 *  2. Ingresa la contraseña → verificarAcceso() la compara con CLAVE_MAESTRA.
 *  3. Si es correcta → se muestra el sistema (#seccion-sistema).
 *  4. El usuario escribe en el buscador y hace clic en "Buscar".
 *  5. buscarEnSheets() consulta la API de Google Sheets.
 *  6. Los datos se filtran, se guardan en listaCompletaFiltrada y se
 *     renderizan en pantalla con actualizarVista().
 *  7. El usuario puede ordenar por apellido con ordenarPorApellido()
 *     y navegar entre páginas con cambiarPagina().
 * ============================================================================
 */


/* ============================================================================
   CONFIGURACIÓN DE CONEXIÓN
   ============================================================================
   Constantes que definen la identidad y el acceso al sistema.
   Se declaran con 'const' porque NO deben cambiar durante la ejecución.
   
   ⚠️  ATENCIÓN: En un entorno de producción real, la CLAVE_MAESTRA y la
   API_KEY_GOOGLE NO deberían estar en el código del cliente (frontend)
   ya que son visibles por cualquier persona que inspeccione el código
   fuente. Lo correcto sería manejarlos desde un servidor (backend).
============================================================================ */

/** Contraseña necesaria para acceder al sistema */
const CLAVE_MAESTRA = "1234";

/**
 * ID de la planilla de Google Sheets donde están los datos de los alumnos.
 * Se obtiene de la URL de la planilla:
 * https://docs.google.com/spreadsheets/d/{ID}/edit
 */
const ID_PLANILLA = '1TzLLrFRzwGyQJBxScsVs5swRXXUpJQMpEatjAv7TFG0';

/**
 * API Key de Google Cloud que autoriza las consultas a Google Sheets API.
 * Se genera en https://console.cloud.google.com/
 */
const API_KEY_GOOGLE = 'AIzaSyBau3ByRr-tdhfcAxGOeHIE3Bw4zggm5XQ';

/**
 * URL completa de la consulta a la Google Sheets API v4.
 * 
 * Desglose:
 * - /spreadsheets/{ID_PLANILLA}: indica la planilla objetivo.
 * - /values/A2%3AG1000: el rango A2:G1000 (%3A es el ":" codificado en URL).
 *   - Comienza en A2 para saltear la fila 1 (encabezados).
 *   - Llega hasta la columna G para capturar el ID del PDF (columna G).
 * - ?key={API_KEY}: autenticación mediante API Key.
 * 
 * Template literals (backticks ``) permiten insertar variables con ${variable}.
 */
const URL_CONSULTA = `https://sheets.googleapis.com/v4/spreadsheets/${ID_PLANILLA}/values/A2%3AG?key=${API_KEY_GOOGLE}`;

/**
 * URL para leer la celda H1 de la planilla, donde el AppScript escribe
 * la fecha/hora de la última actualización al finalizar vincularTodosLosFolios().
 * 
 * H1 es una celda de "metadatos": no forma parte de los datos de alumnos
 * (que empiezan en A2), sino que sirve como indicador de estado del sistema.
 * 
 * El rango H1%3AH1 es el equivalente codificado en URL de "H1:H1".
 */
const URL_FECHA_ACTUALIZACION = `https://sheets.googleapis.com/v4/spreadsheets/${ID_PLANILLA}/values/H1%3AH1?key=${API_KEY_GOOGLE}`;


/* ============================================================================
   VARIABLES GLOBALES DE ESTADO
   ============================================================================
   Estas variables almacenan el "estado" actual de la aplicación.
   Se declaran con 'let' porque SÍ cambian durante la ejecución.
============================================================================ */

/**
 * Array que guarda los resultados que coinciden con la búsqueda actual.
 * Se actualiza cada vez que se hace una nueva búsqueda o se ordena la lista.
 * El renderizado siempre trabaja sobre ESTA lista, no sobre los datos crudos.
 * @type {Array[]}
 */
let listaCompletaFiltrada = [];

/**
 * Número de la página actual en la vista de resultados paginados.
 * Empieza en 1 y se actualiza con cambiarPagina().
 * @type {number}
 */
let paginaActual = 1;

/**
 * Cantidad de registros de alumnos a mostrar por cada página.
 * Cambiar este número ajusta el tamaño de cada "página" de resultados.
 * @type {number}
 */
const REGISTROS_POR_PAGINA = 10;

/**
 * Controla la dirección del ordenamiento alfabético.
 * - true  → próximo clic ordenará A → Z (ascendente)
 * - false → próximo clic ordenará Z → A (descendente)
 * Se alterna automáticamente en cada llamada a ordenarPorApellido().
 * @type {boolean}
 */
let ordenAscendente = true;


/* ============================================================================
   FUNCIÓN: normalizar()
   ============================================================================
   Limpia un texto para hacer búsquedas más flexibles e inclusivas.
   
   Transformaciones que aplica:
   1. Convierte a minúsculas: "PÉREZ" → "pérez"
   2. Descompone caracteres con tilde: "é" → "e" + acento
   3. Elimina los signos diacríticos (tildes, diéresis, etc.)
   4. Resultado: "Pérez" → "perez"
   
   Esto permite que si el usuario escribe "perez", el sistema encuentre
   alumnos llamados "Pérez", "PÉREZ" o "peréz".
   
   @param {*} texto - El texto a normalizar. Puede ser cualquier tipo.
   @returns {string} - El texto limpio, en minúsculas y sin acentos.
============================================================================ */
const normalizar = (texto) => {
    if (!texto) return ""; // Si el texto es null, undefined o vacío, retorna cadena vacía
    return texto
        .toString()                         // Convierte a string (por si llega un número como DNI)
        .toLowerCase()                      // Todo a minúsculas
        .normalize("NFD")                   // Descompone los caracteres acentuados (NFD = Canonical Decomposition)
        .replace(/[\u0300-\u036f]/g, "");   // Elimina los signos diacríticos (rango Unicode de acentos)
};


/* ============================================================================
   FUNCIÓN: verificarAcceso()
   ============================================================================
   Compara la contraseña ingresada por el usuario con la CLAVE_MAESTRA.
   Si coinciden, oculta el login y muestra el sistema principal.
   Si no coinciden, muestra una alerta con mensaje de error.
   
   Esta función se llama desde:
   - El botón "Ingresar al Sistema" del login (onclick)
   - La tecla Enter cuando el campo de contraseña está enfocado (onkeydown)
============================================================================ */
function verificarAcceso() {
    // Obtiene el valor actual del campo de contraseña
    const claveIngresada = document.getElementById('campoClave').value;

    if (claveIngresada === CLAVE_MAESTRA) {
        // ✅ Contraseña correcta: ocultamos el login y mostramos el sistema
        document.getElementById('pantalla-acceso').style.display = 'none';
        document.getElementById('seccion-sistema').style.display = 'block';
    } else {
        // ❌ Contraseña incorrecta: alertamos al usuario
        alert("⚠️ Contraseña incorrecta. Intentá de nuevo.");
        // Limpia el campo para que el usuario vuelva a escribir
        document.getElementById('campoClave').value = '';
        document.getElementById('campoClave').focus();
    }
}


/* ============================================================================
   FUNCIÓN: buscarEnSheets()
   ============================================================================
   Punto de entrada principal de la búsqueda. Realiza los siguientes pasos:
   
   1. Lee el texto del campo de búsqueda y el filtro de libro seleccionado.
   2. Muestra el indicador de carga.
   3. Consulta la API de Google Sheets con fetch() — en paralelo obtiene:
      a) Los datos de alumnos (rango A2:G1000)
      b) La fecha de última actualización (celda H1)
   4. Filtra los resultados que coincidan con la búsqueda Y el filtro de libro.
   5. Guarda los resultados en listaCompletaFiltrada.
   6. Reinicia la paginación a la página 1.
   7. Llama a actualizarVista() para renderizar los resultados.
   8. Actualiza el badge de fecha en la cabecera con actualizarBadgeFecha().
   
   Esta función se llama desde:
   - El botón "Buscar" (onclick)
   - La tecla Enter en el campo de búsqueda (onkeyup)
   
   ESTRUCTURA DE LOS DATOS EN GOOGLE SHEETS (columnas):
   - Columna A (índice 0): [no se usa directamente en el filtro]
   - Columna B (índice 1): Apellido y Nombre del alumno
   - Columna C (índice 2): [no se usa]
   - Columna D (índice 3): Número de Libro (ej: "M1", "M2")
   - Columna E (índice 4): Número de Folio
   - Columna F (índice 5): DNI del alumno
   - Columna G (índice 6): ID del archivo PDF en Google Drive
   - Celda H1:            Fecha/hora de la última actualización del sistema
============================================================================ */
function buscarEnSheets() {
    // --- 1. Leer los valores del formulario ---
    const textoBusqueda = normalizar(document.getElementById('inputNombre').value);
    const libroFiltro = document.getElementById('selectLibro').value.toUpperCase();

    // --- 2. Mostrar spinner de carga mientras se espera la respuesta ---
    mostrarCarga(true);

    /**
     * --- 3. Consultar la API de Google Sheets EN PARALELO ---
     * 
     * Promise.all() ejecuta ambos fetch() al mismo tiempo (en paralelo),
     * en lugar de hacerlos uno después del otro (secuencial).
     * 
     * Esto es más eficiente: el tiempo total de espera es el de la
     * solicitud más lenta, NO la suma de ambas.
     * 
     * Promise.all recibe un array de Promesas y devuelve una nueva Promesa
     * que se resuelve cuando TODAS las promesas del array se resuelven.
     * El resultado es un array con las respuestas en el mismo orden.
     */
    Promise.all([
        fetch(URL_CONSULTA).then(r => r.json()),
        fetch(URL_FECHA_ACTUALIZACION).then(r => r.json())
    ])
        .then(([datosAlumnos, datosFecha]) => {
            // datosAlumnos → respuesta del rango A2:G1000
            // datosFecha   → respuesta de la celda H1

            // --- 4. Filtrar los datos de alumnos recibidos ---
            
            /**
             * datosAlumnos.values es un array de arrays (matriz bidimensional).
             * Cada elemento representa una fila de la planilla.
             * Ej: [["", "García Juan", "", "M1", "45", "30111222", "1abc..."]]
             */
            if (!datosAlumnos.values) {
                // Si la planilla está vacía o no tiene datos en el rango
                listaCompletaFiltrada = [];
            } else {
                listaCompletaFiltrada = datosAlumnos.values.filter(fila => {
                    // Extraemos los valores de cada columna relevante
                    const nombre = normalizar(fila[1]);                   // Col B: Nombre
                    const dni = fila[5] ? fila[5].toString() : "";       // Col F: DNI
                    const libro = (fila[3] || "").toUpperCase();         // Col D: Libro

                    /**
                     * Doble condición de filtrado:
                     * - coincideBusqueda: el texto ingresado aparece en el nombre O en el DNI
                     * - coincideLibro: el libro seleccionado coincide, O no se eligió filtro
                     * 
                     * Solo se incluye la fila si AMBAS condiciones son verdaderas.
                     */
                    const coincideBusqueda = nombre.includes(textoBusqueda) || dni.includes(textoBusqueda);
                    const coincideLibro = libroFiltro === "" || libro === libroFiltro;

                    return coincideBusqueda && coincideLibro;
                });
            }

            // --- 5 y 6. Reiniciar página y renderizar resultados ---
            paginaActual = 1;
            actualizarVista();

            // --- 7. Actualizar el badge de fecha con el valor leído de H1 ---
            /**
             * datosFecha.values tiene la forma: [["texto de H1"]]
             * Es un array de filas, donde cada fila es un array de celdas.
             * Por eso accedemos con [0][0] para llegar al valor de la celda H1.
             */
            const fechaTexto = datosFecha.values && datosFecha.values[0] && datosFecha.values[0][0]
                ? datosFecha.values[0][0]
                : null;
            actualizarBadgeFecha(fechaTexto);
        })
        .catch(error => {
            // Error de red o de la API: mostramos mensaje de error en consola y alerta
            console.error("Error al consultar Google Sheets:", error);
            alert("❌ Hubo un error al conectar con la base de datos. Verificá tu conexión a internet.");
        })
        .finally(() => {
            // Se ejecuta siempre al terminar, haya error o no. Oculta el spinner.
            mostrarCarga(false);
        });
}


/* ============================================================================
   FUNCIÓN: ordenarPorApellido()
   ============================================================================
   Ordena alfabéticamente el array listaCompletaFiltrada por el campo
   "Apellido y Nombre" (columna B, índice 1 del array de cada fila).
   
   Alterna entre orden A→Z y Z→A cada vez que se llama.
   Actualiza el ícono visual de la columna para dar feedback al usuario.
   Luego llama a actualizarVista() para reflejar el nuevo orden en pantalla.
   
   Esta función se llama desde:
   - El encabezado de la columna "Apellido y Nombre" (onclick)
   - El botón "Ordenar A-Z" visible solo en celulares
   
   @returns {void} - Retorna temprano sin hacer nada si no hay resultados.
============================================================================ */
function ordenarPorApellido() {
    // No hace nada si no hay datos para ordenar
    if (listaCompletaFiltrada.length === 0) return;

    /**
     * Array.sort() ordena el array IN PLACE (modifica el array original).
     * La función comparadora recibe dos elementos (a, b) y debe retornar:
     *  - número negativo si 'a' debe ir ANTES que 'b'
     *  - número positivo si 'a' debe ir DESPUÉS que 'b'
     *  - 0 si son iguales
     * 
     * Normalizamos ambos nombres antes de comparar para que la ñ, los
     * acentos, etc. no interfieran con el orden correcto.
     */
    listaCompletaFiltrada.sort((filaA, filaB) => {
        const nombreA = normalizar(filaA[1]); // Nombre del alumno A
        const nombreB = normalizar(filaB[1]); // Nombre del alumno B

        if (nombreA < nombreB) return ordenAscendente ? -1 : 1;
        if (nombreA > nombreB) return ordenAscendente ? 1 : -1;
        return 0; // Son iguales: no cambian de posición
    });

    // Actualiza el ícono de la columna para mostrar la dirección del orden actual
    const iconoOrden = document.getElementById('iconoOrden');
    if (iconoOrden) {
        iconoOrden.innerText = ordenAscendente ? "▲" : "▼";
    }

    // Invierte el flag para que el próximo clic ordene en dirección contraria
    ordenAscendente = !ordenAscendente;

    // Volvemos a la primera página para mostrar el inicio de la lista ordenada
    paginaActual = 1;
    actualizarVista();
}


/* ============================================================================
   FUNCIÓN: actualizarVista()
   ============================================================================
   Renderiza (dibuja) los resultados en pantalla basándose en:
   - listaCompletaFiltrada: la lista filtrada y/o ordenada actual
   - paginaActual: qué "trozo" de la lista mostrar
   
   Genera dinámicamente el HTML para:
   - La tabla de resultados (visible en escritorio)
   - Las tarjetas de alumno (visible en celular)
   - Los controles de paginación
   - El contador de resultados
   
   Es el "motor de renderizado" de la aplicación: todo lo visual
   pasa por esta función.
============================================================================ */
function actualizarVista() {
    // Referencias a los elementos del DOM que vamos a modificar
    const tablaBody = document.getElementById('cuerpoTabla');
    const contenedorTarjetas = document.getElementById('contenedorTarjetas');
    const controles = document.getElementById('controles-paginacion');
    const contador = document.getElementById('contadorResultados');

    /**
     * Calculamos qué registros mostrar en la página actual.
     * 
     * Ejemplo con 25 resultados, 10 por página, en página 2:
     * - inicio = (2-1) * 10 = 10 → empezamos desde el índice 10
     * - fin = 10 + 10 = 20 → terminamos en el índice 20 (no incluido)
     * - slice(10, 20) devuelve los registros 11 al 20
     */
    const inicio = (paginaActual - 1) * REGISTROS_POR_PAGINA;
    const fin = inicio + REGISTROS_POR_PAGINA;
    const paginaDeAlumnos = listaCompletaFiltrada.slice(inicio, fin);

    // --- Actualizar el contador de resultados ---
    if (listaCompletaFiltrada.length > 0) {
        contador.textContent = `${listaCompletaFiltrada.length} resultado${listaCompletaFiltrada.length !== 1 ? 's' : ''} encontrado${listaCompletaFiltrada.length !== 1 ? 's' : ''}`;
    } else {
        contador.textContent = '';
    }

    // --- Caso: sin resultados ---
    if (paginaDeAlumnos.length === 0) {
        tablaBody.innerHTML = `
            <tr>
                <td colspan="5" class="celda-estado">
                    ${listaCompletaFiltrada.length === 0 
                        ? 'Ingresá datos para comenzar la búsqueda.' 
                        : 'No se encontraron registros con esos datos.'}
                </td>
            </tr>`;
        contenedorTarjetas.innerHTML = '';
        controles.classList.add('oculto');
        controles.classList.remove('visible');
        return; // Salimos de la función, no hay nada más que hacer
    }

    // --- Caso: hay resultados para mostrar ---
    
    let htmlTabla = '';    // Acumula el HTML de las filas de la tabla
    let htmlTarjetas = ''; // Acumula el HTML de las tarjetas de celular

    // Iteramos sobre cada alumno de la página actual
    paginaDeAlumnos.forEach(alumno => {
        /**
         * Extraemos los datos del alumno.
         * El operador "|| '---'" provee un valor por defecto si la celda está vacía.
         */
        const nombre   = alumno[1] || '---'; // Columna B: Apellido y Nombre
        const libro    = alumno[3] || '---'; // Columna D: Número de Libro
        const folio    = alumno[4] || '---'; // Columna E: Número de Folio
        const dni      = alumno[5] || '---'; // Columna F: DNI
        const idPdf    = alumno[6];          // Columna G: ID del PDF en Google Drive

        // Genera HTML de la fila para la TABLA (vista escritorio)
        htmlTabla += `
            <tr>
                <td>
                    <span style="font-family: 'Courier New', monospace; font-size:0.83rem; color:#4a5568;">
                        ${dni}
                    </span>
                </td>
                <td style="font-weight: 600;">${nombre}</td>
                <td>
                    <span class="badge-libro">${libro}</span>
                </td>
                <td style="color:#4a5568;">${folio}</td>
                <td style="text-align:center;">
                    <button 
                        onclick="abrirPdf('${idPdf}')" 
                        class="btn-ver-pdf"
                        title="Ver documento PDF de ${nombre}"
                    >
                        Ver PDF
                    </button>
                </td>
            </tr>`;

        // Genera HTML de la TARJETA para la vista móvil (celular)
        htmlTarjetas += `
            <div class="tarjeta-alumno">
                <div>
                    <div class="tarjeta-nombre">${nombre}</div>
                    <div class="tarjeta-dni">DNI: ${dni}</div>
                    <div class="tarjeta-info">Libro: ${libro} &nbsp;|&nbsp; Folio: ${folio}</div>
                </div>
                <button 
                    onclick="abrirPdf('${idPdf}')" 
                    class="btn-ver-pdf"
                    title="Ver PDF"
                >
                    PDF
                </button>
            </div>`;
    });

    // Insertamos el HTML generado en los contenedores del DOM
    tablaBody.innerHTML = htmlTabla;
    contenedorTarjetas.innerHTML = htmlTarjetas;

    // --- Actualizar los controles de paginación ---
    
    // Calculamos el total de páginas necesarias
    const totalPaginas = Math.ceil(listaCompletaFiltrada.length / REGISTROS_POR_PAGINA);

    // Mostramos los controles
    controles.classList.remove('oculto');
    controles.classList.add('visible');

    // Actualizamos el indicador "Página X de Y"
    document.getElementById('indicadorPagina').textContent = `Página ${paginaActual} de ${totalPaginas}`;

    /**
     * Deshabilitamos los botones según corresponda:
     * - "Anterior" se deshabilita si estamos en la primera página
     * - "Siguiente" se deshabilita si estamos en la última página
     */
    document.getElementById('btnAnterior').disabled = (paginaActual === 1);
    document.getElementById('btnSiguiente').disabled = (paginaActual === totalPaginas);
}


/* ============================================================================
   FUNCIÓN: cambiarPagina()
   ============================================================================
   Avanza o retrocede en la paginación de resultados.
   
   @param {number} direccion - Cuántas páginas moverse:
   -  1 → avanza a la página siguiente
   - -1 → retrocede a la página anterior
   
   Después de cambiar la página, hace scroll hacia arriba para que el 
   usuario vea los nuevos registros desde el inicio.
============================================================================ */
function cambiarPagina(direccion) {
    paginaActual += direccion;
    actualizarVista();
    // Sube el scroll al inicio de la página para que el usuario vea los resultados
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ============================================================================
   FUNCIÓN: abrirPdf()
   ============================================================================
   Abre el visualizador de PDF de Google Drive en una nueva pestaña del 
   navegador, usando el ID único del archivo almacenado en la columna G
   de la planilla.
   
   La URL de vista previa de Google Drive tiene el formato:
   https://drive.google.com/file/d/{ID_DEL_ARCHIVO}/preview
   
   @param {string} idArchivo - El ID único del archivo en Google Drive.
   Si es vacío, "undefined" o la palabra "no", muestra una alerta.
============================================================================ */
function abrirPdf(idArchivo) {
    // Verificamos que el ID sea válido antes de intentar abrir
    if (idArchivo && idArchivo !== "no" && idArchivo !== "undefined") {
        // Construimos la URL y la abrimos en una nueva pestaña
        const urlPdf = `https://drive.google.com/file/d/${idArchivo}/preview`;
        window.open(urlPdf, "_blank");
    } else {
        // No hay PDF asociado a este alumno
        alert("⚠️ Este registro no tiene un PDF vinculado.");
    }
}


/* ============================================================================
   FUNCIÓN: mostrarCarga()
   ============================================================================
   Muestra u oculta el indicador visual de carga (spinner).
   Se usa mientras se espera la respuesta de la API de Google Sheets.
   
   @param {boolean} mostrar - true para mostrar el spinner, false para ocultarlo.
============================================================================ */
function mostrarCarga(mostrar) {
    const indicador = document.getElementById('indicador-carga');
    if (!indicador) return; // Salida segura si el elemento no existe

    if (mostrar) {
        indicador.classList.remove('oculto');
        indicador.classList.add('visible');
    } else {
        indicador.classList.remove('visible');
        indicador.classList.add('oculto');
    }
}


/* ============================================================================
   FUNCIÓN: actualizarBadgeFecha()
   ============================================================================
   Muestra u oculta el badge de "Actualizado al..." en la cabecera del sistema.
   
   El badge lee el valor de la celda H1 del Sheet, que es escrito automáticamente
   por el AppScript (Code.gs) cada vez que se ejecuta vincularTodosLosFolios().
   
   Comportamiento:
   - Si H1 tiene texto  → muestra el badge con ese texto como fecha.
   - Si H1 está vacía   → oculta el badge completamente (no muestra nada).
   
   Esto permite que el badge refleje siempre exactamente lo que vos cargaste
   en la celda, sin transformaciones ni formateos automáticos.
   
   @param {string|null} fechaTexto - El texto de la celda H1, o null si está vacía.
============================================================================ */
function actualizarBadgeFecha(fechaTexto) {
    const badge = document.getElementById('badge-actualizacion');
    if (!badge) return; // Salida segura si el elemento no existe en el HTML

    if (fechaTexto) {
        // H1 tiene contenido: actualizamos el texto del badge y lo hacemos visible
        badge.querySelector('.badge-fecha-texto').textContent = fechaTexto;
        badge.classList.remove('badge-oculto');
        badge.classList.add('badge-visible');
    } else {
        // H1 está vacía: ocultamos el badge
        badge.classList.remove('badge-visible');
        badge.classList.add('badge-oculto');
    }
}
