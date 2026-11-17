"use strict";

/* =========================================================
   MENSAJERÍA EXPRESS
   ÁREA DE COBERTURAS - GUATEMALA

   FUNCIONES:
   - Departamentos
   - Municipios
   - Pintar manual
   - Círculo
   - Rectángulo
   - Polígono
   - Borrador circular por partes
   - Editar
   - Eliminar
   - Guardar / cargar
   - Deshacer / rehacer
   - Buscador
   - Lista de departamentos

   IMPORTANTE:
   - SIN PINCEL
   - MAPA: #mapaGuatemala
========================================================= */


/* =========================================================
   CONFIGURACIÓN
========================================================= */

const CONFIG = {

    mapaId: "mapaGuatemala",

    centro: [
        15.7835,
        -90.2308
    ],

    zoomInicial: 7,

    limiteBusqueda: 25,

    coloresCobertura: {
        mismoDia: "#22c55e",
        siguienteDia: "#3b82f6",
        "72horas": "#ef4444"
    },

    urls: {

        departamentos:
            "https://www.geovisitguatemala.gt/arcgis/rest/services/Departamentos/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson",

        municipios:
            "https://www.geovisitguatemala.gt/arcgis/rest/services/MunicipiosINE/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson",

        nominatim:
            "https://nominatim.openstreetmap.org/search"
    },

    anchoPintadoMetros: 25,

    pasosCirculo:
        32,

    pasosBuffer:
        12,

    maxHistorial:
        50
};


/* =========================================================
   STORAGE
========================================================= */

const STORAGE_ZONAS =
    "mensajeriaExpressZonasCobertura";

const STORAGE_MUNICIPIOS =
    "mensajeriaExpressMunicipiosCobertura";


/* =========================================================
   VARIABLES
========================================================= */

let mapa = null;

let capaDepartamentos = null;
let capaMunicipios = null;

let grupoCoberturas = null;
let grupoMarcadoresBusqueda = null;

let departamentosData = null;
let municipiosData = null;

let zonaSeleccionada = null;

let herramientaActiva = "ninguna";

let nivelActivo = "departamentos";

let historial = [];
let indiceHistorial = -1;

let guardandoHistorial = false;
let cargandoEstado = false;

let debounceBusqueda = null;

let dibujandoLinea = false;
let puntosLinea = [];

let mouseMoveLineaHandler = null;
let mouseUpLineaHandler = null;

let mascaraGuatemala = null;

let modoGeomanActivo = false;

let ultimaEdicion = 0;


/* =========================================================
   INICIO
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    iniciarSistema
);


async function iniciarSistema() {

    try {

        verificarDependencias();

        verificarMapaHTML();

        crearMapa();

        configurarEventosInterfaz();

        configurarEventosMapa();

        configurarTeclado();

        cargarEstadoGuardado();

        await cargarGeografia();

        actualizarListaDepartamentos();

        actualizarInterfazHerramienta();

        actualizarEstadoMapa();

        guardarEstadoInicialHistorial();

        notificar(
            "Sistema listo",
            "El mapa de Guatemala está preparado.",
            "success"
        );

    } catch (error) {

        console.error(
            "Error al iniciar:",
            error
        );

        notificar(
            "Error de inicio",
            error.message ||
                "No se pudo iniciar el mapa.",
            "error"
        );
    }
}


/* =========================================================
   DEPENDENCIAS
========================================================= */

function verificarDependencias() {

    if (typeof L === "undefined") {

        throw new Error(
            "Leaflet no está cargado."
        );
    }

    if (typeof turf === "undefined") {

        throw new Error(
            "Turf.js no está cargado."
        );
    }

    if (!L.PM && !L.pm) {

        throw new Error(
            "Leaflet-Geoman no está cargado."
        );
    }
}


function verificarMapaHTML() {

    const elemento =
        document.getElementById(
            CONFIG.mapaId
        );

    if (!elemento) {

        throw new Error(
            "No existe #mapaGuatemala en el HTML."
        );
    }
}


/* =========================================================
   CREAR MAPA
========================================================= */

function crearMapa() {

    mapa =
        L.map(
            CONFIG.mapaId,
            {
                center:
                    CONFIG.centro,

                zoom:
                    CONFIG.zoomInicial,

                zoomControl:
                    true,

                preferCanvas:
                    true
            }
        );


    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,

            attribution:
                "&copy; OpenStreetMap contributors"
        }
    ).addTo(mapa);


    grupoCoberturas =
        L.geoJSON(
            null,
            {
                style:
                    estiloCobertura,

                onEachFeature:
                    configurarFeatureCobertura
            }
        ).addTo(mapa);


    grupoMarcadoresBusqueda =
        L.featureGroup()
            .addTo(mapa);


    configurarGeoman();

    actualizarInteraccionCapas();
}


/* =========================================================
   GEOMAN
========================================================= */

function configurarGeoman() {

    const pm =
        mapa.pm || mapa.PM;

    if (!pm) {
        return;
    }

    try {

        pm.setGlobalOptions({
            snappable: false,
            allowSelfIntersection: false
        });

    } catch (error) {
        console.warn(
            "No se pudieron establecer opciones Geoman.",
            error
        );
    }


    mapa.on(
        "pm:create",
        manejarCreacionGeoman
    );


    mapa.on(
        "pm:edit",
        manejarEdicionGeoman
    );
}


/* =========================================================
   CREACIÓN GEOMAN
========================================================= */

function manejarCreacionGeoman(evento) {

    if (!evento || !evento.layer) {
        return;
    }

    const layer =
        evento.layer;

    const herramienta =
        herramientaActiva;


    if (
        herramienta ===
        "borrador"
    ) {

        manejarBorradorGeoman(
            layer
        );

        return;
    }


    if (
        herramienta ===
        "eliminar"
    ) {

        try {
            layer.remove();
        } catch (_) {}

        return;
    }


    if (
        herramienta !== "circulo" &&
        herramienta !== "rectangulo" &&
        herramienta !== "poligono"
    ) {

        try {
            layer.remove();
        } catch (_) {}

        return;
    }


    const geojson =
        convertirLayerAGeoJSON(
            layer
        );


    try {
        layer.remove();
    } catch (_) {}


    if (!geojson) {

        notificar(
            "Error",
            "No se pudo obtener la geometría.",
            "error"
        );

        return;
    }


    procesarNuevaGeometria(
        geojson,
        herramienta
    );
}


/* =========================================================
   EDITAR GEOMETRÍA
========================================================= */

function manejarEdicionGeoman() {

    if (
        herramientaActiva !==
        "editar"
    ) {
        return;
    }

    const ahora =
        Date.now();

    if (
        ahora - ultimaEdicion <
        250
    ) {
        return;
    }

    ultimaEdicion =
        ahora;

    guardarGeometriasEditadas();

}


/* =========================================================
   GUARDAR GEOMETRÍAS EDITADAS
========================================================= */

function guardarGeometriasEditadas() {

    if (!grupoCoberturas) {
        return;
    }

    const features =
        grupoCoberturas
            .toGeoJSON()
            .features;


    if (!features.length) {
        guardarEstado();
        guardarHistorial();
        return;
    }


    const actuales =
        obtenerCoberturas();


    const resultado =
        actuales.map(
            cobertura => {

                const encontrada =
                    features.find(
                        f =>
                            f.properties &&
                            cobertura.properties &&
                            f.properties.id ===
                                cobertura.properties.id
                    );


                if (!encontrada) {
                    return cobertura;
                }


                return {

                    type:
                        "Feature",

                    properties:
                        Object.assign(
                            {},
                            cobertura.properties
                        ),

                    geometry:
                        encontrada.geometry
                };
            }
        );


    reemplazarCoberturas(
        resultado
    );


    guardarEstado();

    guardarHistorial();
}


/* =========================================================
   CONVERTIR LAYER
========================================================= */

function convertirLayerAGeoJSON(layer) {

    if (!layer) {
        return null;
    }


    if (
        typeof L.Circle !== "undefined" &&
        layer instanceof L.Circle
    ) {

        const centro =
            layer.getLatLng();

        const radio =
            layer.getRadius();


        return turf.circle(
            [
                centro.lng,
                centro.lat
            ],

            radio / 1000,

            {
                steps:
                    CONFIG.pasosCirculo,

                units:
                    "kilometers"
            }
        );
    }


    if (
        typeof layer.toGeoJSON ===
        "function"
    ) {

        return layer.toGeoJSON();
    }


    return null;
}


/* =========================================================
   GEOMETRÍA VÁLIDA
========================================================= */

function geometriaValida(feature) {

    if (!feature ||
        !feature.geometry) {

        return false;
    }

    const tipo =
        feature.geometry.type;


    return [
        "Polygon",
        "MultiPolygon",
        "LineString",
        "MultiLineString",
        "Point"
    ].includes(tipo);
}


/* =========================================================
   INTERSECCIÓN CON GUATEMALA
========================================================= */

function geometriaIntersecaGuatemala(
    feature
) {

    if (!feature) {
        return false;
    }


    const bounds =
        [
            -92.30,
            13.70,
            -88.10,
            17.90
        ];


    try {

        const bbox =
            turf.bbox(feature);


        const fueraBounds =
            bbox[2] < bounds[0] ||
            bbox[0] > bounds[2] ||
            bbox[3] < bounds[1] ||
            bbox[1] > bounds[3];


        if (fueraBounds) {
            return false;
        }

    } catch (_) {}


    if (
        !departamentosData ||
        !Array.isArray(
            departamentosData.features
        )
    ) {

        return true;
    }


    for (
        const departamento
        of departamentosData.features
    ) {

        try {

            if (
                turf.booleanIntersects(
                    feature,
                    departamento
                )
            ) {

                return true;
            }

        } catch (_) {}
    }


    return false;
}


/* =========================================================
   RECORTAR A GUATEMALA
========================================================= */

function recortarAGuatemala(
    feature
) {

    if (!feature) {
        return null;
    }


    if (
        !departamentosData ||
        !Array.isArray(
            departamentosData.features
        ) ||
        departamentosData.features.length === 0
    ) {

        return feature;
    }


    try {

        const bbox =
            turf.bbox(feature);

        const bboxGuatemala =
            [
                -92.30,
                13.70,
                -88.10,
                17.90
            ];


        if (
            bbox[0] >= bboxGuatemala[0] &&
            bbox[1] >= bboxGuatemala[1] &&
            bbox[2] <= bboxGuatemala[2] &&
            bbox[3] <= bboxGuatemala[3]
        ) {

            return feature;
        }

    } catch (_) {}


    const partes = [];


    for (
        const departamento
        of departamentosData.features
    ) {

        try {

            if (
                !turf.booleanIntersects(
                    feature,
                    departamento
                )
            ) {

                continue;
            }


            const interseccion =
                intersectarTurf(
                    feature,
                    departamento
                );


            if (interseccion) {

                partes.push(
                    interseccion
                );
            }

        } catch (_) {}
    }


    if (!partes.length) {
        return null;
    }


    if (partes.length === 1) {
        return partes[0];
    }


    return unirFeatures(
        partes
    );
}


/* =========================================================
   INTERSECTAR TURF
========================================================= */

function intersectarTurf(
    a,
    b
) {

    if (
        !a ||
        !b ||
        typeof turf.intersect !==
            "function"
    ) {

        return null;
    }


    try {

        const fc =
            turf.featureCollection([
                a,
                b
            ]);


        const resultado =
            turf.intersect(
                fc
            );


        if (resultado) {
            return resultado;
        }

    } catch (_) {}


    try {

        const resultado =
            turf.intersect(
                a,
                b
            );


        if (resultado) {
            return resultado;
        }

    } catch (_) {}


    return null;
}


/* =========================================================
   UNIR FEATURES
========================================================= */

function unirFeatures(
    features
) {

    if (!features ||
        !features.length) {

        return null;
    }


    if (features.length === 1) {
        return features[0];
    }


    try {

        const geometries =
            features
                .map(
                    f =>
                        f.geometry
                )
                .filter(Boolean);


        if (!geometries.length) {
            return null;
        }


        if (
            geometries.every(
                g =>
                    g.type ===
                    "Polygon"
            )
        ) {

            return {
                type:
                    "Feature",

                properties:
                    {},

                geometry: {
                    type:
                        "MultiPolygon",

                    coordinates:
                        geometries.map(
                            g =>
                                g.coordinates
                        )
                }
            };
        }


        const poligonos = [];


        geometries.forEach(
            g => {

                if (
                    g.type ===
                    "Polygon"
                ) {

                    poligonos.push(
                        g.coordinates
                    );

                } else if (
                    g.type ===
                    "MultiPolygon"
                ) {

                    g.coordinates.forEach(
                        p =>
                            poligonos.push(
                                p
                            )
                    );
                }
            }
        );


        if (!poligonos.length) {
            return null;
        }


        return {
            type:
                "Feature",

            properties:
                {},

            geometry: {
                type:
                    "MultiPolygon",

                coordinates:
                    poligonos
            }
        };

    } catch (error) {

        console.error(
            "Error uniendo geometrías:",
            error
        );

        return features[0];
    }
}


/* =========================================================
   PROCESAR NUEVA GEOMETRÍA
========================================================= */

function procesarNuevaGeometria(
    geojson,
    herramienta
) {

    if (
        !geometriaValida(
            geojson
        )
    ) {

        notificar(
            "Geometría inválida",
            "La zona dibujada no es válida.",
            "error"
        );

        return;
    }


    if (
        !geometriaIntersecaGuatemala(
            geojson
        )
    ) {

        notificar(
            "Fuera de Guatemala",
            "La zona debe estar dentro de Guatemala.",
            "warning"
        );

        return;
    }


    const geometriaFinal =
        recortarAGuatemala(
            geojson
        );


    if (!geometriaFinal) {

        notificar(
            "Zona inválida",
            "No hay área dentro de Guatemala.",
            "warning"
        );

        return;
    }


    crearCobertura(
        geometriaFinal,
        herramienta
    );
}


/* =========================================================
   COLOR
========================================================= */

function obtenerColorCobertura(
    tipo
) {

    switch (
        normalizarTipoCobertura(
            tipo
        )
    ) {

        case "siguientedia":
            return CONFIG
                .coloresCobertura
                .siguienteDia;

        case "72horas":
            return CONFIG
                .coloresCobertura
                ["72horas"];

        default:
            return CONFIG
                .coloresCobertura
                .mismoDia;
    }
}


/* =========================================================
   NORMALIZAR TIPO
========================================================= */
function obtenerColorCobertura(tipo) {
    const valor = String(tipo || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\s_-]+/g, "");

    if (
        valor === "mismodia" ||
        valor === "sameday"
    ) {
        return "#22c55e"; // VERDE
    }

    if (
        valor === "siguientedia" ||
        valor === "nextday" ||
        valor === "next"
    ) {
        return "#3b82f6"; // AZUL
    }

    if (
        valor === "72horas" ||
        valor === "72h"
    ) {
        return "#ef4444"; // ROJO
    }

    if (
        valor === "nocobertura" ||
        valor === "sincobertura"
    ) {
        return "#94a3b8"; // GRIS
    }

    if (
        valor === "alto"
    ) {
        return "#f59e0b"; // NARANJA
    }

    return "#22c55e";
}


/* =========================================================
   ESTILO COBERTURA
========================================================= */

function estiloCobertura(
    feature
) {

    const props =
        feature &&
        feature.properties
            ? feature.properties
            : {};


    const color =
        obtenerColorCobertura(
            props.tipo
        );


    const estado =
        String(
            props.estado ||
            "activa"
        )
        .toLowerCase();


    return {

        color:
            color,

        weight:
            estado === "inactiva"
                ? 2
                : 3,

        opacity:
            estado === "inactiva"
                ? 0.45
                : 0.95,

        fillColor:
            color,

        fillOpacity:
            estado === "inactiva"
                ? 0.08
                : 0.35
    };
}


/* =========================================================
   CREAR COBERTURA
========================================================= */

function crearCobertura(
    geometria,
    herramienta
) {

    if (!geometria) {
        return null;
    }


    const tipo =
        obtenerTipoFormulario();


    const estado =
        obtenerEstadoFormulario();


    const feature =
        {
            type:
                "Feature",

            properties: {

                id:
                    generarId(),

                nombre:
                    obtenerNombreFormulario(
                        herramienta
                    ),

                tipo:
                    tipo,

                estado:
                    estado,

                herramienta:
                    herramienta,

                nivel:
                    nivelActivo,

                fecha:
                    new Date()
                        .toISOString()
            },

            geometry:
                geometria.geometry
        };


    const existentes =
        obtenerCoberturas();


    const nuevaLista =
        existentes.concat(
            feature
        );


    reemplazarCoberturas(
        nuevaLista
    );


    zonaSeleccionada =
        feature.properties.id;


    cargarDatosZonaFormulario(
        feature
    );


    guardarEstado();

    guardarHistorial();

    notificar(
        "Cobertura creada",
        "La zona se pintó correctamente.",
        "success"
    );


    return feature;
}


/* =========================================================
   OBTENER COBERTURAS
========================================================= */

function obtenerCoberturas() {

    if (!grupoCoberturas) {
        return [];
    }


    try {

        return grupoCoberturas
            .toGeoJSON()
            .features || [];

    } catch (_) {

        return [];
    }
}


/* =========================================================
   REEMPLAZAR COBERTURAS
========================================================= */

function reemplazarCoberturas(
    features
) {

    if (!grupoCoberturas) {
        return;
    }


    grupoCoberturas.clearLayers();


    if (!features ||
        !features.length) {

        actualizarInteraccionCapas();

        return;
    }


    grupoCoberturas.addData({
        type:
            "FeatureCollection",

        features:
            features
    });


    actualizarInteraccionCapas();
}


/* =========================================================
   CONFIGURAR FEATURE
========================================================= */

function configurarFeatureCobertura(
    feature,
    layer
) {

    if (!layer) {
        return;
    }


    layer.feature =
        feature;


    layer.on(
        "click",
        function (evento) {

            L.DomEvent.stopPropagation(
                evento
            );


            if (
                herramientaActiva ===
                "eliminar"
            ) {

                eliminarCobertura(
                    feature
                );

                return;
            }


            if (
                herramientaActiva ===
                "borrador"
            ) {

                return;
            }


            seleccionarCobertura(
                feature,
                layer
            );
        }
    );


    layer.on(
        "mouseover",
        function () {

            if (
                herramientaActiva ===
                "eliminar"
            ) {

                layer.setStyle({
                    weight: 5
                });
            }
        }
    );


    layer.on(
        "mouseout",
        function () {

            layer.setStyle(
                estiloCobertura(
                    feature
                )
            );
        }
    );
}


/* =========================================================
   SELECCIONAR COBERTURA
========================================================= */

function seleccionarCobertura(
    feature,
    layer
) {

    if (!feature) {
        return;
    }


    zonaSeleccionada =
        feature.properties &&
        feature.properties.id
            ? feature.properties.id
            : null;


    cargarDatosZonaFormulario(
        feature
    );


    if (
        layer &&
        layer.setStyle
    ) {

        layer.setStyle({
            weight:
                5
        });

    }


    notificar(
        "Cobertura seleccionada",
        "Puedes editar sus datos.",
        "info"
    );
}


/* =========================================================
   CARGAR FORMULARIO
========================================================= */

function cargarDatosZonaFormulario(
    feature
) {

    const props =
        feature &&
        feature.properties
            ? feature.properties
            : {};


    establecerValor(
        "nombreZona",
        props.nombre ||
            ""
    );


    establecerValor(
        "tipoCobertura",
        props.tipo ||
            "mismoDia"
    );


    establecerValor(
        "estadoCobertura",
        props.estado ||
            "activa"
    );
}


/* =========================================================
   FORMULARIO
========================================================= */

function establecerValor(
    id,
    valor
) {

    const elemento =
        document.getElementById(
            id
        );

    if (elemento) {
        elemento.value =
            valor;
    }
}


function obtenerValor(
    id,
    defecto
) {

    const elemento =
        document.getElementById(
            id
        );


    if (!elemento) {
        return defecto;
    }


    return elemento.value ||
        defecto;
}


function obtenerNombreFormulario(
    herramienta
) {

    const nombre =
        obtenerValor(
            "nombreZona",
            ""
        )
        .trim();


    if (nombre) {
        return nombre;
    }


    if (
        herramienta ===
        "departamento"
    ) {

        return "Cobertura departamental";
    }


    if (
        herramienta ===
        "municipio"
    ) {

        return "Cobertura municipal";
    }


    return "Nueva cobertura";
}


function obtenerTipoFormulario() {

    return obtenerValor(
        "tipoCobertura",
        "mismoDia"
    );
}


function obtenerEstadoFormulario() {

    return obtenerValor(
        "estadoCobertura",
        "activa"
    );
}


/* =========================================================
   GUARDAR ZONA
========================================================= */

function guardarZonaSeleccionada() {

    if (!zonaSeleccionada) {

        notificar(
            "Sin selección",
            "Selecciona primero una cobertura.",
            "warning"
        );

        return;
    }


    const features =
        obtenerCoberturas();


    const indice =
        features.findIndex(
            f =>
                f.properties &&
                f.properties.id ===
                    zonaSeleccionada
        );


    if (indice === -1) {
        return;
    }


    features[indice]
        .properties.nombre =
            obtenerValor(
                "nombreZona",
                "Nueva cobertura"
            );


    features[indice]
        .properties.tipo =
            obtenerTipoFormulario();


    features[indice]
        .properties.estado =
            obtenerEstadoFormulario();


    reemplazarCoberturas(
        features
    );


    guardarEstado();

    guardarHistorial();

    notificar(
        "Guardado",
        "La cobertura fue actualizada.",
        "success"
    );
}


/* =========================================================
   ELIMINAR COBERTURA COMPLETA
========================================================= */

function eliminarCobertura(
    feature
) {

    if (!feature) {
        return;
    }


    const id =
        feature.properties &&
        feature.properties.id;


    if (!id) {
        return;
    }


    const nuevas =
        obtenerCoberturas()
            .filter(
                f =>
                    !(
                        f.properties &&
                        f.properties.id ===
                            id
                    )
            );


    reemplazarCoberturas(
        nuevas
    );


    if (
        zonaSeleccionada ===
        id
    ) {

        zonaSeleccionada =
            null;
    }


    guardarEstado();

    guardarHistorial();

    actualizarInterfazHerramienta();


    notificar(
        "Cobertura eliminada",
        "La cobertura completa fue eliminada.",
        "success"
    );
}


/* =========================================================
   BORRADOR CIRCULAR
========================================================= */

function manejarBorradorGeoman(
    layer
) {

    const geometria =
        convertirLayerAGeoJSON(
            layer
        );


    try {
        layer.remove();
    } catch (_) {}


    if (!geometria) {

        notificar(
            "Error",
            "No se pudo crear el borrador.",
            "error"
        );

        return;
    }


    borrarParcialConGeometria(
        geometria
    );
}


/* =========================================================
   BORRAR POR PARTES
========================================================= */

function borrarParcialConGeometria(
    geometriaBorrador
) {

    if (!geometriaBorrador) {
        return;
    }


    const coberturas =
        obtenerCoberturas();


    if (!coberturas.length) {

        notificar(
            "Sin coberturas",
            "No hay coberturas para borrar.",
            "warning"
        );

        return;
    }


    const nuevasCoberturas =
        [];


    let modificadas = 0;
    let eliminadas = 0;


    for (
        const feature
        of coberturas
    ) {

        if (
            !feature ||
            !feature.geometry
        ) {

            continue;
        }


        let intersecta =
            false;


        try {

            intersecta =
                turf.booleanIntersects(
                    feature,
                    geometriaBorrador
                );

        } catch (_) {

            intersecta =
                false;
        }


        if (!intersecta) {

            nuevasCoberturas.push(
                feature
            );

            continue;
        }


        const diferencia =
            diferenciaTurf(
                feature,
                geometriaBorrador
            );


        if (!diferencia) {

            eliminadas++;

            continue;
        }


        if (
            !diferencia.geometry
        ) {

            eliminadas++;

            continue;
        }


        if (
            geometriaVacia(
                diferencia
            )
        ) {

            eliminadas++;

            continue;
        }


        const nuevo =
            {
                type:
                    "Feature",

                properties:
                    Object.assign(
                        {},
                        feature.properties
                    ),

                geometry:
                    diferencia.geometry
            };


        nuevasCoberturas.push(
            nuevo
        );


        modificadas++;
    }


    if (
        modificadas === 0 &&
        eliminadas === 0
    ) {

        notificar(
            "Sin cambios",
            "El círculo no tocó ninguna cobertura.",
            "info"
        );

        return;
    }


    reemplazarCoberturas(
        nuevasCoberturas
    );


    if (
        zonaSeleccionada
    ) {

        const sigue =
            nuevasCoberturas.some(
                f =>
                    f.properties &&
                    f.properties.id ===
                        zonaSeleccionada
            );


        if (!sigue) {

            zonaSeleccionada =
                null;
        }
    }


    guardarEstado();

    guardarHistorial();


    notificar(
        "Borrado parcial",
        `${modificadas} cobertura(s) modificada(s)${eliminadas ? ` y ${eliminadas} eliminada(s)` : ""}.`,
        "success"
    );
}


/* =========================================================
   DIFERENCIA TURF
========================================================= */

function diferenciaTurf(
    featureA,
    featureB
) {

    if (
        !featureA ||
        !featureB
    ) {

        return null;
    }


    if (
        typeof turf.difference !==
        "function"
    ) {

        return null;
    }


    try {

        const resultado =
            turf.difference(
                turf.featureCollection([
                    featureA,
                    featureB
                ])
            );


        if (
            resultado !==
            undefined
        ) {

            return resultado;
        }

    } catch (_) {}


    try {

        const resultado =
            turf.difference(
                featureA,
                featureB
            );


        if (
            resultado !==
            undefined
        ) {

            return resultado;
        }

    } catch (_) {}


    return null;
}


/* =========================================================
   GEOMETRÍA VACÍA
========================================================= */

function geometriaVacia(
    feature
) {

    if (!feature ||
        !feature.geometry) {

        return true;
    }


    const geometry =
        feature.geometry;


    if (
        geometry.type ===
        "GeometryCollection"
    ) {

        return !geometry.geometries ||
            geometry.geometries.length === 0;
    }


    if (
        geometry.type ===
        "Polygon"
    ) {

        return !geometry.coordinates ||
            geometry.coordinates.length === 0;
    }


    if (
        geometry.type ===
        "MultiPolygon"
    ) {

        return !geometry.coordinates ||
            geometry.coordinates.length === 0;
    }


    return false;
}


/* =========================================================
   INICIAR BORRADOR
========================================================= */

function iniciarModoBorrador() {

    detenerTodasLasHerramientas();


    herramientaActiva =
        "borrador";


    actualizarInterfazHerramienta();

    actualizarInteraccionCapas();


    try {

        mapa.pm.enableDraw(
            "Circle",
            {
                snappable:
                    false
            }
        );

    } catch (error) {

        console.error(
            error
        );

        notificar(
            "Error",
            "No se pudo activar el borrador circular.",
            "error"
        );
    }
}


/* =========================================================
   PINTAR MANUAL
========================================================= */

function iniciarModoPintar() {

    detenerTodasLasHerramientas();


    herramientaActiva =
        "pintar";


    actualizarInterfazHerramienta();

    actualizarInteraccionCapas();


    dibujandoLinea =
        false;

    puntosLinea =
        [];


    mouseMoveLineaHandler =
        function (evento) {

            if (!dibujandoLinea) {
                return;
            }


            agregarPuntoLinea(
                evento.latlng
            );
        };


    mouseUpLineaHandler =
        function () {

            finalizarLineaPintada();
        };


    mapa.on(
        "mousemove",
        mouseMoveLineaHandler
    );


    mapa.on(
        "mouseup",
        mouseUpLineaHandler
    );


    mapa.on(
        "mousedown",
        iniciarLineaPintada
    );
}


/* =========================================================
   INICIAR LÍNEA
========================================================= */

function iniciarLineaPintada(
    evento
) {

    if (
        herramientaActiva !==
        "pintar"
    ) {

        return;
    }


    dibujandoLinea =
        true;


    puntosLinea =
        [];


    agregarPuntoLinea(
        evento.latlng
    );


    if (
        mapa.dragging
    ) {

        mapa.dragging.disable();
    }
}


/* =========================================================
   AGREGAR PUNTO
========================================================= */

function agregarPuntoLinea(
    latlng
) {

    if (!latlng) {
        return;
    }


    if (
        puntosLinea.length ===
        0
    ) {

        puntosLinea.push(
            latlng
        );

        return;
    }


    const ultimo =
        puntosLinea[
            puntosLinea.length - 1
        ];


    const distancia =
        mapa.distance(
            ultimo,
            latlng
        );


    if (
        distancia >= 5
    ) {

        puntosLinea.push(
            latlng
        );
    }
}


/* =========================================================
   FINALIZAR LÍNEA
========================================================= */

function finalizarLineaPintada() {

    if (!dibujandoLinea) {
        return;
    }


    dibujandoLinea =
        false;


    if (
        mapa.dragging
    ) {

        mapa.dragging.enable();
    }


    if (
        puntosLinea.length <
        2
    ) {

        puntosLinea =
            [];

        return;
    }


    const coordenadas =
        puntosLinea.map(
            punto =>
                [
                    punto.lng,
                    punto.lat
                ]
        );


    puntosLinea =
        [];


    try {

        let linea =
            turf.lineString(
                coordenadas
            );


        let cobertura =
            turf.buffer(
                linea,
                CONFIG.anchoPintadoMetros /
                    1000,
                {
                    units:
                        "kilometers",

                    steps:
                        CONFIG.pasosBuffer
                }
            );


        if (!cobertura) {
            return;
        }


        if (
            !geometriaIntersecaGuatemala(
                cobertura
            )
        ) {

            notificar(
                "Fuera de Guatemala",
                "La zona pintada está fuera de Guatemala.",
                "warning"
            );

            return;
        }


        cobertura =
            recortarAGuatemala(
                cobertura
            );


        if (!cobertura) {
            return;
        }


        crearCobertura(
            cobertura,
            "pintar"
        );

    } catch (error) {

        console.error(
            "Error pintando:",
            error
        );

        notificar(
            "Error",
            "No se pudo crear la cobertura.",
            "error"
        );
    }
}


/* =========================================================
   CÍRCULO
========================================================= */

function iniciarModoCirculo() {

    iniciarModoGeoman(
        "circulo"
    );
}


/* =========================================================
   RECTÁNGULO
========================================================= */

function iniciarModoRectangulo() {

    iniciarModoGeoman(
        "rectangulo"
    );
}


/* =========================================================
   POLÍGONO
========================================================= */

function iniciarModoPoligono() {

    iniciarModoGeoman(
        "poligono"
    );
}


/* =========================================================
   GEOMAN
========================================================= */

function iniciarModoGeoman(
    herramienta
) {

    detenerTodasLasHerramientas();


    herramientaActiva =
        herramienta;


    actualizarInterfazHerramienta();

    actualizarInteraccionCapas();


    let tipo =
        null;


    if (
        herramienta ===
        "circulo"
    ) {

        tipo =
            "Circle";

    } else if (
        herramienta ===
        "rectangulo"
    ) {

        tipo =
            "Rectangle";

    } else if (
        herramienta ===
        "poligono"
    ) {

        tipo =
            "Polygon";
    }


    if (!tipo) {
        return;
    }


    try {

        mapa.pm.enableDraw(
            tipo,
            {
                snappable:
                    false,

                allowSelfIntersection:
                    false
            }
        );

    } catch (error) {

        console.error(
            error
        );

        notificar(
            "Error",
            "No se pudo activar la herramienta.",
            "error"
        );
    }
}


/* =========================================================
   DETENER HERRAMIENTAS
========================================================= */

function detenerTodasLasHerramientas() {

    if (!mapa) {
        return;
    }


    try {

        if (
            mapa.pm
        ) {

            mapa.pm.disableDraw();
        }

    } catch (_) {}


    if (
        mouseMoveLineaHandler
    ) {

        mapa.off(
            "mousemove",
            mouseMoveLineaHandler
        );

        mouseMoveLineaHandler =
            null;
    }


    if (
        mouseUpLineaHandler
    ) {

        mapa.off(
            "mouseup",
            mouseUpLineaHandler
        );

        mouseUpLineaHandler =
            null;
    }


    mapa.off(
        "mousedown",
        iniciarLineaPintada
    );


    if (
        mapa.dragging &&
        !mapa.dragging.enabled()
    ) {

        mapa.dragging.enable();
    }


    dibujandoLinea =
        false;


    puntosLinea =
        [];


    herramientaActiva =
        "ninguna";


    modoGeomanActivo =
        false;


    actualizarInteraccionCapas();

    actualizarInterfazHerramienta();
}


/* =========================================================
   EDITAR
========================================================= */

function iniciarModoEditar() {

    detenerTodasLasHerramientas();


    herramientaActiva =
        "editar";


    actualizarInterfazHerramienta();

    actualizarInteraccionCapas();


    try {

        grupoCoberturas.eachLayer(
            layer => {

                if (
                    layer.pm
                ) {

                    layer.pm.enable({
                        allowSelfIntersection:
                            false
                    });
                }
            }
        );

    } catch (error) {

        console.error(
            "Error activando edición:",
            error
        );
    }


    notificar(
        "Editar",
        "Selecciona una cobertura y modifica su forma.",
        "info"
    );
}


/* =========================================================
   ELIMINAR
========================================================= */

function iniciarModoEliminar() {

    detenerTodasLasHerramientas();


    herramientaActiva =
        "eliminar";


    actualizarInterfazHerramienta();

    actualizarInteraccionCapas();


    notificar(
        "Eliminar",
        "Haz clic sobre una cobertura para eliminarla completa.",
        "info"
    );
}


/* =========================================================
   NIVEL DEPARTAMENTOS
========================================================= */

function iniciarDepartamentos() {

    nivelActivo =
        "departamentos";

    detenerTodasLasHerramientas();

    actualizarInteraccionCapas();

    notificar(
        "Departamentos",
        "Haz clic en un departamento para pintarlo.",
        "info"
    );
}


/* =========================================================
   PINTAR MUNICIPIOS
========================================================= */

function iniciarPintarMunicipios() {

    nivelActivo =
        "municipios";

    detenerTodasLasHerramientas();

    actualizarInteraccionCapas();

    notificar(
        "Municipios",
        "Haz clic en un municipio para pintarlo.",
        "info"
    );
}


/* =========================================================
   PINTAR DEPARTAMENTO
========================================================= */

function seleccionarDepartamento(
    feature
) {

    if (!feature) {
        return;
    }


    const geometria =
        convertirFeatureAPoligono(
            feature
        );


    if (!geometria) {
        return;
    }


    crearCoberturaNivel(
        geometria,
        "departamento",
        obtenerNombreFeature(
            feature
        ),
        obtenerIdFeature(
            feature
        )
    );
}


/* =========================================================
   PINTAR MUNICIPIO
========================================================= */

function seleccionarMunicipio(
    feature
) {

    if (!feature) {
        return;
    }


    const geometria =
        convertirFeatureAPoligono(
            feature
        );


    if (!geometria) {
        return;
    }


    crearCoberturaNivel(
        geometria,
        "municipio",
        obtenerNombreFeature(
            feature
        ),
        obtenerIdFeature(
            feature
        )
    );
}


/* =========================================================
   CREAR COBERTURA POR NIVEL
========================================================= */

function crearCoberturaNivel(
    geometria,
    nivel,
    nombre,
    idOrigen
) {

    const existentes =
        obtenerCoberturas();


    const repetida =
        existentes.find(
            f => {

                const p =
                    f.properties ||
                    {};


                return (
                    p.nivel ===
                        nivel &&
                    String(
                        p.origenId
                    ) ===
                        String(
                            idOrigen
                        )
                );
            }
        );


    if (repetida) {

        zonaSeleccionada =
            repetida.properties.id;


        cargarDatosZonaFormulario(
            repetida
        );


        notificar(
            "Ya existe",
            `${nombre} ya está pintado.`,
            "info"
        );

        return;
    }


    const feature =
        {
            type:
                "Feature",

            properties: {

                id:
                    generarId(),

                nombre:
                    nombre ||
                    `Cobertura ${nivel}`,

                tipo:
                    obtenerTipoFormulario(),

                estado:
                    obtenerEstadoFormulario(),

                nivel:
                    nivel,

                origenId:
                    idOrigen,

                origenNombre:
                    nombre,

                fecha:
                    new Date()
                        .toISOString()
            },

            geometry:
                geometria.geometry
        };


    reemplazarCoberturas(
        existentes.concat(
            feature
        )
    );


    zonaSeleccionada =
        feature.properties.id;


    cargarDatosZonaFormulario(
        feature
    );


    guardarEstado();

    guardarHistorial();


    notificar(
        `${capitalizar(nivel)} pintado`,
        `${nombre || "La zona"} fue agregada a la cobertura.`,
        "success"
    );
}


/* =========================================================
   CONVERTIR FEATURE
========================================================= */

function convertirFeatureAPoligono(
    feature
) {

    if (!feature) {
        return null;
    }


    if (
        feature.type ===
        "Feature"
    ) {

        return feature;
    }


    if (
        feature.type ===
        "Polygon" ||
        feature.type ===
        "MultiPolygon"
    ) {

        return {
            type:
                "Feature",

            properties:
                {},

            geometry:
                feature
        };
    }


    return null;
}


/* =========================================================
   NOMBRE FEATURE
========================================================= */

function obtenerNombreFeature(
    feature
) {

    const props =
        feature.properties ||
        {};


    const candidatos = [
        "nombre",
        "NOMBRE",
        "name",
        "NAME",
        "departamento",
        "DEPARTAMENTO",
        "municipio",
        "MUNICIPIO",
        "nom_dep",
        "nom_mun",
        "dpto",
        "muni"
    ];


    for (
        const campo
        of candidatos
    ) {

        if (
            props[campo] !==
                undefined &&
            props[campo] !==
                null &&
            String(
                props[campo]
            ).trim()
        ) {

            return String(
                props[campo]
            ).trim();
        }
    }


    return "Zona sin nombre";
}


/* =========================================================
   ID FEATURE
========================================================= */

function obtenerIdFeature(
    feature
) {

    const props =
        feature.properties ||
        {};


    const candidatos = [
        "id",
        "ID",
        "objectid",
        "OBJECTID",
        "codigo",
        "CODIGO",
        "code",
        "CODE",
        "id_departamento",
        "id_municipio"
    ];


    for (
        const campo
        of candidatos
    ) {

        if (
            props[campo] !==
                undefined &&
            props[campo] !==
                null
        ) {

            return String(
                props[campo]
            );
        }
    }


    return generarId();
}


/* =========================================================
   CARGAR GEOGRAFÍA
========================================================= */

async function cargarGeografia() {

    notificar(
        "Cargando mapa",
        "Cargando departamentos y municipios...",
        "info"
    );


    const resultados =
        await Promise.all([
            cargarGeoJSON(
                CONFIG.urls.departamentos
            ),

            cargarGeoJSON(
                CONFIG.urls.municipios
            )
        ]);


    departamentosData =
        resultados[0];


    municipiosData =
        resultados[1];


    crearCapaDepartamentos();

    crearCapaMunicipios();

    construirMascaraGuatemala();

    actualizarInteraccionCapas();
}


/* =========================================================
   FETCH GEOJSON
========================================================= */

async function cargarGeoJSON(
    url
) {

    const respuesta =
        await fetch(
            url,
            {
                method:
                    "GET",

                headers: {
                    Accept:
                        "application/json"
                }
            }
        );


    if (!respuesta.ok) {

        throw new Error(
            `Error HTTP ${respuesta.status}`
        );
    }


    const datos =
        await respuesta.json();


    if (
        !datos ||
        !Array.isArray(
            datos.features
        )
    ) {

        throw new Error(
            "La respuesta geográfica no es válida."
        );
    }


    return datos;
}


/* =========================================================
   CAPA DEPARTAMENTOS
========================================================= */

function crearCapaDepartamentos() {

    if (
        capaDepartamentos
    ) {

        mapa.removeLayer(
            capaDepartamentos
        );
    }


    capaDepartamentos =
        L.geoJSON(
            departamentosData,
            {
                style:
                    estiloDepartamento,

                onEachFeature:
                    function (
                        feature,
                        layer
                    ) {

                        layer.on(
                            "click",
                            function (
                                evento
                            ) {

                                L.DomEvent
                                    .stopPropagation(
                                        evento
                                    );


                                if (
                                    nivelActivo ===
                                    "departamentos"
                                ) {

                                    seleccionarDepartamento(
                                        feature
                                    );
                                }
                            }
                        );


                        layer.bindTooltip(
                            obtenerNombreFeature(
                                feature
                            ),
                            {
                                sticky:
                                    true
                            }
                        );
                    }
            }
        ).addTo(mapa);
}


/* =========================================================
   ESTILO DEPARTAMENTO
========================================================= */

function estiloDepartamento() {

    return {

        color:
            "#64748b",

        weight:
            1.5,

        fillColor:
            "#e5e7eb",

        fillOpacity:
            0.28
    };
}


/* =========================================================
   CAPA MUNICIPIOS
========================================================= */

function crearCapaMunicipios() {

    if (
        capaMunicipios
    ) {

        mapa.removeLayer(
            capaMunicipios
        );
    }


    capaMunicipios =
        L.geoJSON(
            municipiosData,
            {
                style:
                    estiloMunicipio,

                onEachFeature:
                    function (
                        feature,
                        layer
                    ) {

                        layer.on(
                            "click",
                            function (
                                evento
                            ) {

                                L.DomEvent
                                    .stopPropagation(
                                        evento
                                    );


                                if (
                                    nivelActivo ===
                                    "municipios"
                                ) {

                                    seleccionarMunicipio(
                                        feature
                                    );
                                }
                            }
                        );


                        layer.bindTooltip(
                            obtenerNombreFeature(
                                feature
                            ),
                            {
                                sticky:
                                    true
                            }
                        );
                    }
            }
        ).addTo(mapa);
}


/* =========================================================
   ESTILO MUNICIPIO
========================================================= */

function estiloMunicipio() {

    return {

        color:
            "#94a3b8",

        weight:
            1,

        fillColor:
            "#ffffff",

        fillOpacity:
            0.08
    };
}


/* =========================================================
   MÁSCARA GUATEMALA
========================================================= */

function construirMascaraGuatemala() {

    mascaraGuatemala =
        null;


    if (
        !departamentosData ||
        !departamentosData.features
    ) {

        return;
    }


    mascaraGuatemala =
        unirFeatures(
            departamentosData.features
        );
}


/* =========================================================
   ACTUALIZAR INTERACCIÓN
========================================================= */

function actualizarInteraccionCapas() {

    if (!mapa) {
        return;
    }


    if (
        capaDepartamentos
    ) {

        capaDepartamentos.eachLayer(
            layer => {

                layer.options.interactive =
                    nivelActivo ===
                    "departamentos";
            }
        );
    }


    if (
        capaMunicipios
    ) {

        capaMunicipios.eachLayer(
            layer => {

                layer.options.interactive =
                    nivelActivo ===
                    "municipios";
            }
        );
    }


    if (
        grupoCoberturas
    ) {

        grupoCoberturas.eachLayer(
            layer => {

                layer.options.interactive =
                    herramientaActiva !==
                        "pintar" &&
                    herramientaActiva !==
                        "borrador";
            }
        );
    }
}


/* =========================================================
   BUSCADOR
========================================================= */

/* =========================================================
   BUSCADOR COMPLETO DE UBICACIONES - GUATEMALA
   - Calles y avenidas
   - Colonias y barrios
   - Residenciales
   - Aldeas y caseríos
   - Municipios y departamentos
   - Comercios y lugares conocidos
   - Sugerencias al escribir
   - Marcador visible en el mapa
========================================================= */

let controladorBusqueda = null;
let numeroSolicitudBusqueda = 0;
let ultimaBusqueda = "";
let marcadorSeleccionado = null;


/* =========================================================
   CONFIGURAR BUSCADOR
========================================================= */

function configurarBuscador() {

    const input = document.getElementById(
        "buscarDepartamento"
    );

    if (!input) {
        console.warn("No existe #buscarDepartamento");
        return;
    }

    const contenedor = document.getElementById(
        "resultadosDirecciones"
    );

    if (contenedor) {
        contenedor.style.display = "block";
        contenedor.style.maxHeight = "320px";
        contenedor.style.overflowY = "auto";
        contenedor.style.position = "relative";
        contenedor.style.zIndex = "9999";
    }

    input.setAttribute(
        "autocomplete",
        "off"
    );

    input.setAttribute(
        "placeholder",
        "Busca calles, colonias, aldeas, municipios..."
    );

    input.addEventListener(
        "input",
        function () {

            actualizarListaDepartamentos();

            buscarDireccionConDebounce(
                input.value.trim()
            );
        }
    );

    input.addEventListener(
        "keydown",
        function (evento) {

            if (evento.key === "Enter") {

                evento.preventDefault();

                clearTimeout(debounceBusqueda);

                buscarDireccion(
                    input.value.trim()
                );
            }

            if (evento.key === "Escape") {
                limpiarResultadosBusqueda();
            }
        }
    );

    const limpiar = document.getElementById(
        "limpiarBusqueda"
    );

    if (limpiar) {

        limpiar.addEventListener(
            "click",
            function () {

                input.value = "";

                ultimaBusqueda = "";

                clearTimeout(debounceBusqueda);

                if (controladorBusqueda) {
                    controladorBusqueda.abort();
                }

                limpiarMarcadoresBusqueda();

                limpiarResultadosBusqueda();

                actualizarListaDepartamentos();

                input.focus();
            }
        );
    }
}


/* =========================================================
   BUSCAR AUTOMÁTICAMENTE
========================================================= */

function buscarDireccionConDebounce(texto) {

    clearTimeout(debounceBusqueda);

    if (texto.length < 3) {

        limpiarResultadosBusqueda();

        if (controladorBusqueda) {
            controladorBusqueda.abort();
        }

        return;
    }

    debounceBusqueda = setTimeout(
        function () {

            buscarDireccion(texto);

        },
        1000
    );
}


/* =========================================================
   BUSCAR EN OPENSTREETMAP
========================================================= */

async function buscarDireccion(texto) {

    texto = String(texto || "").trim();

    if (texto.length < 3) {
        return;
    }

    if (texto === ultimaBusqueda) {
        return;
    }

    ultimaBusqueda = texto;

    const solicitud = ++numeroSolicitudBusqueda;

    if (controladorBusqueda) {
        controladorBusqueda.abort();
    }

    controladorBusqueda = new AbortController();

    mostrarEstadoBusqueda(
        "Buscando ubicaciones..."
    );

    try {

        const parametros = new URLSearchParams({

            q: texto,

            format: "jsonv2",

            addressdetails: "1",

            namedetails: "1",

            extratags: "1",

            limit: String(CONFIG.limiteBusqueda),

            countrycodes: "gt",

            "accept-language": "es",

            dedupe: "1",

            viewbox: "-92.30,17.90,-88.10,13.70"

        });

        const respuesta = await fetch(
            `${CONFIG.urls.nominatim}?${parametros.toString()}`,
            {
                method: "GET",

                headers: {
                    Accept: "application/json"
                },

                signal: controladorBusqueda.signal
            }
        );

        if (!respuesta.ok) {
            throw new Error(
                `Error HTTP ${respuesta.status}`
            );
        }

        const resultados = await respuesta.json();

        if (solicitud !== numeroSolicitudBusqueda) {
            return;
        }

        mostrarResultadosDirecciones(
            resultados
        );

    } catch (error) {

        if (error.name === "AbortError") {
            return;
        }

        console.error(
            "Error buscando ubicaciones:",
            error
        );

        if (solicitud === numeroSolicitudBusqueda) {

            mostrarEstadoBusqueda(
                "No se pudieron cargar las ubicaciones. Intenta nuevamente."
            );
        }
    }
}


/* =========================================================
   MOSTRAR ESTADO DE BÚSQUEDA
========================================================= */

function mostrarEstadoBusqueda(texto) {

    const contenedor = document.getElementById(
        "resultadosDirecciones"
    );

    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = "";

    const elemento = document.createElement("div");

    elemento.className = "sin-resultados";

    elemento.textContent = texto;

    elemento.style.padding = "12px";

    elemento.style.fontSize = "13px";

    elemento.style.color = "#64748b";

    contenedor.appendChild(elemento);
}


/* =========================================================
   IDENTIFICAR TIPO DE UBICACIÓN
========================================================= */

function obtenerTipoUbicacion(resultado) {

    const address = resultado.address || {};

    const tipo = String(
        resultado.type || ""
    ).toLowerCase();

    const categoria = String(
        resultado.class || ""
    ).toLowerCase();

    if (
        address.road ||
        [
            "road",
            "residential",
            "service",
            "street",
            "pedestrian",
            "living_street",
            "primary",
            "secondary",
            "tertiary"
        ].includes(tipo)
    ) {
        return "Calle o avenida";
    }

    if (
        address.neighbourhood ||
        address.suburb ||
        address.quarter ||
        [
            "neighbourhood",
            "suburb",
            "quarter"
        ].includes(tipo)
    ) {
        return "Colonia o barrio";
    }

    if (
        address.hamlet ||
        tipo === "hamlet"
    ) {
        return "Caserío";
    }

    if (
        address.village ||
        tipo === "village"
    ) {
        return "Aldea";
    }

    if (
        address.town ||
        tipo === "town"
    ) {
        return "Población o municipio";
    }

    if (
        address.city ||
        tipo === "city"
    ) {
        return "Ciudad";
    }

    if (
        address.county ||
        tipo === "county"
    ) {
        return "Municipio o distrito";
    }

    if (
        address.state ||
        tipo === "administrative"
    ) {
        return "Departamento o división administrativa";
    }

    if (
        categoria === "shop" ||
        categoria === "amenity" ||
        categoria === "tourism" ||
        categoria === "office"
    ) {
        return "Comercio o lugar de interés";
    }

    return "Ubicación";
}


/* =========================================================
   MOSTRAR RESULTADOS
========================================================= */

function mostrarResultadosDirecciones(resultados) {

    const contenedor = document.getElementById(
        "resultadosDirecciones"
    );

    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = "";

    if (!Array.isArray(resultados) || !resultados.length) {

        mostrarEstadoBusqueda(
            "No se encontraron ubicaciones. Prueba con otro nombre."
        );

        return;
    }

    resultados.forEach(
        resultado => {

            if (
                !resultado.lat ||
                !resultado.lon
            ) {
                return;
            }

            const elemento = document.createElement("button");

            elemento.type = "button";

            elemento.className = "resultado-direccion";

            elemento.style.display = "block";

            elemento.style.width = "100%";

            elemento.style.textAlign = "left";

            elemento.style.padding = "11px 13px";

            elemento.style.border = "0";

            elemento.style.borderBottom = "1px solid #e5e7eb";

            elemento.style.background = "#ffffff";

            elemento.style.cursor = "pointer";

            elemento.style.color = "#1e293b";

            elemento.style.fontSize = "13px";

            elemento.style.lineHeight = "1.5";

            const tipo = obtenerTipoUbicacion(
                resultado
            );

            const nombre = document.createElement("strong");

            nombre.textContent =
                resultado.name ||
                resultado.display_name.split(",")[0];

            nombre.style.display = "block";

            nombre.style.fontSize = "14px";

            nombre.style.color = "#0f172a";

            const descripcion = document.createElement("span");

            descripcion.textContent =
                resultado.display_name;

            descripcion.style.display = "block";

            descripcion.style.color = "#64748b";

            descripcion.style.marginTop = "3px";

            const etiqueta = document.createElement("span");

            etiqueta.textContent = tipo;

            etiqueta.style.display = "inline-block";

            etiqueta.style.marginTop = "5px";

            etiqueta.style.padding = "2px 7px";

            etiqueta.style.borderRadius = "5px";

            etiqueta.style.background = "#eff6ff";

            etiqueta.style.color = "#2563eb";

            etiqueta.style.fontSize = "11px";

            elemento.appendChild(nombre);

            elemento.appendChild(descripcion);

            elemento.appendChild(etiqueta);

            elemento.addEventListener(
                "mouseenter",
                function () {
                    elemento.style.background = "#f1f5f9";
                }
            );

            elemento.addEventListener(
                "mouseleave",
                function () {
                    elemento.style.background = "#ffffff";
                }
            );

            elemento.addEventListener(
                "click",
                function () {

                    seleccionarResultadoBusqueda(
                        resultado
                    );
                }
            );

            contenedor.appendChild(elemento);
        }
    );

    if (!contenedor.children.length) {

        mostrarEstadoBusqueda(
            "No se encontraron ubicaciones válidas."
        );
    }
}


/* =========================================================
   ESCAPAR TEXTO PARA POPUP
========================================================= */

function escaparTextoHTML(texto) {

    return String(texto || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   SELECCIONAR Y MARCAR UBICACIÓN
========================================================= */

function seleccionarResultadoBusqueda(resultado) {

    if (!resultado || !mapa) {
        return;
    }

    const lat = Number(resultado.lat);

    const lon = Number(resultado.lon);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
    ) {
        return;
    }

    limpiarMarcadoresBusqueda();

    const tipo = obtenerTipoUbicacion(resultado);

    const nombre =
        resultado.name ||
        resultado.display_name.split(",")[0];

    const direccion =
        resultado.display_name ||
        nombre;

    /* MARCADOR PRINCIPAL */

    marcadorSeleccionado = L.marker(
        [lat, lon],
        {
            title: nombre,
            riseOnHover: true,
            keyboard: true
        }
    );

    marcadorSeleccionado.addTo(
        grupoMarcadoresBusqueda
    );

    /* CÍRCULO DE DESTACADO */

    const circulo = L.circle(
        [lat, lon],
        {
            radius: 45,

            color: "#ef4444",

            weight: 2,

            opacity: 1,

            fillColor: "#ef4444",

            fillOpacity: 0.18,

            interactive: false
        }
    );

    circulo.addTo(
        grupoMarcadoresBusqueda
    );

    /* INFORMACIÓN DEL MARCADOR */

    const contenidoPopup = `
        <div style="min-width:180px;max-width:260px;">
            <strong style="font-size:14px;color:#0f172a;">
                ${escaparTextoHTML(nombre)}
            </strong>

            <div style="margin-top:5px;color:#64748b;font-size:12px;">
                ${escaparTextoHTML(tipo)}
            </div>

            <div style="margin-top:7px;font-size:12px;color:#334155;">
                ${escaparTextoHTML(direccion)}
            </div>

            <div style="margin-top:8px;color:#16a34a;font-size:11px;font-weight:600;">
                Ubicación marcada en el mapa
            </div>
        </div>
    `;

    marcadorSeleccionado.bindPopup(
        contenidoPopup
    );

    /* ACERCAR MAPA */

    let zoom = 16;

    if (
        tipo.includes("Departamento")
    ) {
        zoom = 9;
    } else if (
        tipo.includes("municipio") ||
        tipo.includes("Ciudad")
    ) {
        zoom = 13;
    } else if (
        tipo.includes("Aldea") ||
        tipo.includes("Caserío")
    ) {
        zoom = 15;
    } else if (
        tipo.includes("Calle") ||
        tipo.includes("Colonia")
    ) {
        zoom = 17;
    }

    mapa.setView(
        [lat, lon],
        zoom,
        {
            animate: true,
            duration: 0.8
        }
    );

    marcadorSeleccionado.openPopup();

    /* ACTUALIZAR INPUT */

    const input = document.getElementById(
        "buscarDepartamento"
    );

    if (input) {
        input.value = nombre;
    }

    ultimaBusqueda = "";

    limpiarResultadosBusqueda();

    notificar(
        "Ubicación encontrada",
        `${nombre} fue marcada en el mapa.`,
        "success"
    );
}


/* =========================================================
   LIMPIAR RESULTADOS
========================================================= */

function limpiarResultadosBusqueda() {

    const contenedor = document.getElementById(
        "resultadosDirecciones"
    );

    if (contenedor) {
        contenedor.innerHTML = "";
    }
}


/* =========================================================
   LIMPIAR MARCADORES
========================================================= */

function limpiarMarcadoresBusqueda() {

    if (grupoMarcadoresBusqueda) {
        grupoMarcadoresBusqueda.clearLayers();
    }

    marcadorSeleccionado = null;
}

/* =========================================================
   LISTA DEPARTAMENTOS
========================================================= */

function actualizarListaDepartamentos() {

    const lista =
        document.getElementById(
            "listaDepartamentos"
        );


    if (!lista) {
        return;
    }


    lista.innerHTML =
        "";


    if (
        !departamentosData ||
        !departamentosData.features
    ) {

        return;
    }


    const input =
        document.getElementById(
            "buscarLista"
        );


    const filtro =
        input
            ? input.value
                .trim()
                .toLowerCase()
            : "";


    let total =
        0;


    departamentosData.features
        .forEach(
            feature => {

                const nombre =
                    obtenerNombreFeature(
                        feature
                    );


                if (
                    filtro &&
                    !nombre
                        .toLowerCase()
                        .includes(
                            filtro
                        )
                ) {

                    return;
                }


                total++;


                const elemento =
                    document.createElement(
                        "button"
                    );


                elemento.type =
                    "button";


                elemento.className =
                    "item-departamento";


                elemento.textContent =
                    nombre;


                elemento.addEventListener(
                    "click",
                    function () {

                        nivelActivo =
                            "departamentos";

                        seleccionarDepartamento(
                            feature
                        );
                    }
                );


                lista.appendChild(
                    elemento
                );
            }
        );


    const totalElemento =
        document.getElementById(
            "totalDepartamentos"
        );


    if (totalElemento) {

        totalElemento.textContent =
            String(
                total
            );
    }
}


/* =========================================================
   EVENTOS INTERFAZ
========================================================= */

function configurarEventosInterfaz() {

    configurarBuscador();


    vincularBoton(
        "btnNuevaZona",
        iniciarModoPintar
    );


    vincularBoton(
        "btnPintar",
        iniciarModoPintar
    );


    vincularBoton(
        "btnPintarMunicipios",
        iniciarPintarMunicipios
    );


    vincularBoton(
        "btnCirculo",
        iniciarModoCirculo
    );


    vincularBoton(
        "btnRectangulo",
        iniciarModoRectangulo
    );


    vincularBoton(
        "btnPoligono",
        iniciarModoPoligono
    );


    vincularBoton(
        "btnBorrador",
        iniciarModoBorrador
    );


    vincularBoton(
        "btnEditarZonas",
        iniciarModoEditar
    );


    vincularBoton(
        "btnEliminarZonas",
        iniciarModoEliminar
    );


    vincularBoton(
        "btnGuardarZona",
        guardarZonaSeleccionada
    );


    vincularBoton(
        "btnGuardarTodo",
        guardarEstadoManual
    );


    vincularBoton(
        "btnCargarTodo",
        cargarEstadoManual
    );


    vincularBoton(
        "btnLimpiarTodo",
        limpiarTodo
    );


    vincularBoton(
        "btnDeshacer",
        deshacer
    );


    vincularBoton(
        "btnRehacer",
        rehacer
    );


    vincularBoton(
        "cerrarModal",
        cerrarModal
    );


    vincularBoton(
        "cerrarModalBoton",
        cerrarModal
    );


    const fondo =
        document.getElementById(
            "modalFondo"
        );


    if (fondo) {

        fondo.addEventListener(
            "click",
            function (
                evento
            ) {

                if (
                    evento.target ===
                    fondo
                ) {

                    cerrarModal();
                }
            }
        );
    }


    const buscarLista =
        document.getElementById(
            "buscarLista"
        );


    if (buscarLista) {

        buscarLista.addEventListener(
            "input",
            actualizarListaDepartamentos
        );
    }


    const limpiarLista =
        document.getElementById(
            "limpiarLista"
        );


    if (limpiarLista) {

        limpiarLista.addEventListener(
            "click",
            function () {

                if (buscarLista) {
                    buscarLista.value =
                        "";
                }

                actualizarListaDepartamentos();
            }
        );
    }


    /*
       Si el HTML todavía tiene
       btnPincel, lo ocultamos.
       No existe ninguna lógica
       de Pincel en este JS.
    */

    const btnPincel =
        document.getElementById(
            "btnPincel"
        );


    if (btnPincel) {

        btnPincel.style.display =
            "none";
    }
}


/* =========================================================
   VINCULAR BOTÓN
========================================================= */

function vincularBoton(
    id,
    funcion
) {

    const elemento =
        document.getElementById(
            id
        );


    if (!elemento) {
        return;
    }


    elemento.addEventListener(
        "click",
        function (
            evento
        ) {

            evento.preventDefault();

            funcion();
        }
    );
}


/* =========================================================
   EVENTOS MAPA
========================================================= */

function configurarEventosMapa() {

    if (!mapa) {
        return;
    }


    mapa.on(
        "click",
        function () {

            if (
                herramientaActiva ===
                "ninguna"
            ) {

                return;
            }
        }
    );
}


/* =========================================================
   TECLADO
========================================================= */

function configurarTeclado() {

    document.addEventListener(
        "keydown",
        function (
            evento
        ) {

            const ctrl =
                evento.ctrlKey ||
                evento.metaKey;


            if (
                ctrl &&
                evento.key.toLowerCase() ===
                    "z"
            ) {

                evento.preventDefault();


                if (
                    evento.shiftKey
                ) {

                    rehacer();

                } else {

                    deshacer();
                }


                return;
            }


            if (
                ctrl &&
                evento.key.toLowerCase() ===
                    "y"
            ) {

                evento.preventDefault();

                rehacer();
            }


            if (
                evento.key ===
                "Escape"
            ) {

                detenerTodasLasHerramientas();
            }
        }
    );
}


/* =========================================================
   GUARDAR STORAGE
========================================================= */

function guardarEstado() {

    if (cargandoEstado) {
        return;
    }


    try {

        const zonas =
            obtenerCoberturas();


        localStorage.setItem(
            STORAGE_ZONAS,
            JSON.stringify({
                version:
                    1,

                fecha:
                    new Date()
                        .toISOString(),

                zonas:
                    zonas
            })
        );


        localStorage.setItem(
            STORAGE_MUNICIPIOS,
            JSON.stringify({
                version:
                    1,

                fecha:
                    new Date()
                        .toISOString(),

                zonas:
                    []
            })
        );

    } catch (error) {

        console.error(
            "Error guardando:",
            error
        );
    }
}


/* =========================================================
   CARGAR STORAGE
========================================================= */

function cargarEstadoGuardado() {

    cargandoEstado =
        true;


    try {

        const texto =
            localStorage.getItem(
                STORAGE_ZONAS
            );


        if (!texto) {

            cargandoEstado =
                false;

            return;
        }


        const datos =
            JSON.parse(
                texto
            );


        let zonas =
            [];


        if (
            Array.isArray(
                datos
            )
        ) {

            zonas =
                datos;

        } else if (
            datos &&
            Array.isArray(
                datos.zonas
            )
        ) {

            zonas =
                datos.zonas;
        }


        if (
            zonas.length
        ) {

            reemplazarCoberturas(
                zonas
            );
        }

    } catch (error) {

        console.error(
            "Error cargando estado:",
            error
        );

    } finally {

        cargandoEstado =
            false;
    }
}


/* =========================================================
   GUARDAR MANUAL
========================================================= */

function guardarEstadoManual() {

    guardarEstado();


    notificar(
        "Guardado",
        "Todas las coberturas fueron guardadas.",
        "success"
    );
}


/* =========================================================
   CARGAR MANUAL
========================================================= */

function cargarEstadoManual() {

    cargarEstadoGuardado();


    notificar(
        "Cargado",
        "Las coberturas guardadas fueron cargadas.",
        "success"
    );
}


/* =========================================================
   LIMPIAR TODO
========================================================= */

function limpiarTodo() {

    const confirmar =
        window.confirm(
            "¿Seguro que deseas eliminar todas las coberturas?"
        );


    if (!confirmar) {
        return;
    }


    reemplazarCoberturas(
        []
    );


    zonaSeleccionada =
        null;


    guardarEstado();

    guardarHistorial();


    notificar(
        "Coberturas eliminadas",
        "Se eliminaron todas las coberturas.",
        "success"
    );
}


/* =========================================================
   HISTORIAL
========================================================= */

function obtenerSnapshot() {

    return JSON.stringify(
        obtenerCoberturas()
    );
}


/* =========================================================
   GUARDAR HISTORIAL INICIAL
========================================================= */

function guardarEstadoInicialHistorial() {

    historial =
        [
            obtenerSnapshot()
        ];


    indiceHistorial =
        0;
}


/* =========================================================
   GUARDAR HISTORIAL
========================================================= */

function guardarHistorial() {

    if (
        guardandoHistorial ||
        cargandoEstado
    ) {

        return;
    }


    const snapshot =
        obtenerSnapshot();


    if (
        historial[
            indiceHistorial
        ] === snapshot
    ) {

        return;
    }


    historial =
        historial.slice(
            0,
            indiceHistorial + 1
        );


    historial.push(
        snapshot
    );


    if (
        historial.length >
        CONFIG.maxHistorial
    ) {

        historial.shift();
    }


    indiceHistorial =
        historial.length -
        1;
}


/* =========================================================
   DESHACER
========================================================= */

function deshacer() {

    if (
        indiceHistorial <=
        0
    ) {

        notificar(
            "Deshacer",
            "No hay acciones para deshacer.",
            "info"
        );

        return;
    }


    indiceHistorial--;


    aplicarSnapshot(
        historial[
            indiceHistorial
        ]
    );
}


/* =========================================================
   REHACER
========================================================= */

function rehacer() {

    if (
        indiceHistorial >=
        historial.length -
            1
    ) {

        notificar(
            "Rehacer",
            "No hay acciones para rehacer.",
            "info"
        );

        return;
    }


    indiceHistorial++;


    aplicarSnapshot(
        historial[
            indiceHistorial
        ]
    );
}


/* =========================================================
   APLICAR SNAPSHOT
========================================================= */

function aplicarSnapshot(
    snapshot
) {

    try {

        const zonas =
            JSON.parse(
                snapshot
            );


        guardandoHistorial =
            true;


        reemplazarCoberturas(
            zonas
        );


        guardarEstado();

    } catch (error) {

        console.error(
            "Error aplicando historial:",
            error
        );

    } finally {

        guardandoHistorial =
            false;
    }
}


/* =========================================================
   ACTUALIZAR INTERFAZ HERRAMIENTA
========================================================= */

function actualizarInterfazHerramienta() {

    const botones = [
        "btnNuevaZona",
        "btnPintar",
        "btnPintarMunicipios",
        "btnCirculo",
        "btnRectangulo",
        "btnPoligono",
        "btnBorrador",
        "btnEditarZonas",
        "btnEliminarZonas"
    ];


    botones.forEach(
        id => {

            const elemento =
                document.getElementById(
                    id
                );


            if (!elemento) {
                return;
            }


            elemento.classList.remove(
                "activo",
                "active",
                "seleccionado"
            );
        }
    );


    const mapaBotones = {

        pintar:
            [
                "btnNuevaZona",
                "btnPintar"
            ],

        departamentos:
            [
                "btnPintar"
            ],

        municipios:
            [
                "btnPintarMunicipios"
            ],

        circulo:
            [
                "btnCirculo"
            ],

        rectangulo:
            [
                "btnRectangulo"
            ],

        poligono:
            [
                "btnPoligono"
            ],

        borrador:
            [
                "btnBorrador"
            ],

        editar:
            [
                "btnEditarZonas"
            ],

        eliminar:
            [
                "btnEliminarZonas"
            ]
    };


    const activos =
        mapaBotones[
            herramientaActiva
        ] || [];


    activos.forEach(
        id => {

            const elemento =
                document.getElementById(
                    id
                );


            if (elemento) {

                elemento.classList.add(
                    "activo"
                );
            }
        }
    );
}


/* =========================================================
   ESTADO MAPA
========================================================= */

function actualizarEstadoMapa() {

    const elementos =
        document.querySelectorAll(
            "[data-estado-herramienta]"
        );


    elementos.forEach(
        elemento => {

            elemento.textContent =
                herramientaActiva;
        }
    );
}


/* =========================================================
   MODAL
========================================================= */

function cerrarModal() {

    const modal =
        document.getElementById(
            "modalDepartamento"
        );


    const fondo =
        document.getElementById(
            "modalFondo"
        );


    if (modal) {

        modal.classList.remove(
            "mostrar",
            "activo",
            "open"
        );

        modal.style.display =
            "none";
    }


    if (fondo) {

        fondo.classList.remove(
            "mostrar",
            "activo",
            "open"
        );

        fondo.style.display =
            "none";
    }
}


/* =========================================================
   NOTIFICACIONES
========================================================= */

function notificar(
    titulo,
    mensaje,
    tipo
) {

    const contenedor =
        document.getElementById(
            "notificacion"
        );


    if (!contenedor) {

        console.log(
            `[${tipo || "info"}] ${titulo}: ${mensaje}`
        );

        return;
    }


    const tituloElemento =
        document.getElementById(
            "notificacionTitulo"
        );


    const mensajeElemento =
        document.getElementById(
            "notificacionMensaje"
        );


    if (tituloElemento) {

        tituloElemento.textContent =
            titulo ||
            "";
    }


    if (mensajeElemento) {

        mensajeElemento.textContent =
            mensaje ||
            "";
    }


    contenedor.classList.remove(
        "success",
        "error",
        "warning",
        "info"
    );


    contenedor.classList.add(
        tipo ||
        "info"
    );


    contenedor.classList.add(
        "mostrar"
    );


    clearTimeout(
        contenedor._timeout
    );


    contenedor._timeout =
        setTimeout(
            function () {

                contenedor.classList.remove(
                    "mostrar"
                );

            },
            3000
        );
}


/* =========================================================
   ID ÚNICO
========================================================= */

function generarId() {

    return (
        "zona_" +
        Date.now().toString(36) +
        "_" +
        Math.random()
            .toString(36)
            .slice(2, 9)
    );
}


/* =========================================================
   CAPITALIZAR
========================================================= */

function capitalizar(
    texto
) {

    if (!texto) {
        return "";
    }


    return (
        texto.charAt(0)
            .toUpperCase() +
        texto.slice(1)
    );
}


/* =========================================================
   EXPONER FUNCIONES
   Para botones HTML que puedan utilizar
   onclick="..."
========================================================= */

window.iniciarModoPintar =
    iniciarModoPintar;

window.iniciarPintarMunicipios =
    iniciarPintarMunicipios;

window.iniciarModoCirculo =
    iniciarModoCirculo;

window.iniciarModoRectangulo =
    iniciarModoRectangulo;

window.iniciarModoPoligono =
    iniciarModoPoligono;

window.iniciarModoBorrador =
    iniciarModoBorrador;

window.iniciarModoEditar =
    iniciarModoEditar;

window.iniciarModoEliminar =
    iniciarModoEliminar;

window.guardarZonaSeleccionada =
    guardarZonaSeleccionada;

window.guardarEstadoManual =
    guardarEstadoManual;

window.cargarEstadoManual =
    cargarEstadoManual;

window.limpiarTodo =
    limpiarTodo;

window.deshacer =
    deshacer;

window.rehacer =
    rehacer;

window.cerrarModal =
    cerrarModal; 
    