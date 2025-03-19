# Servidor MCP para YouTube

<div align="center">
  <img src="https://img.shields.io/badge/YouTube_API-v3-red" alt="YouTube API Version">
  <img src="https://img.shields.io/badge/MCP-Model_Context_Protocol-green" alt="MCP">
  <img src="https://img.shields.io/badge/Claude-compatible-blue" alt="Claude Compatible">
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="License">
</div>

Este es un servidor MCP (Model Context Protocol) que permite a Claude y otros asistentes de IA interactuar con la API de YouTube. El servidor proporciona herramientas para buscar videos, obtener detalles de videos específicos, buscar canales y obtener información detallada de canales.

## ¿Qué es MCP?

Model Context Protocol (MCP) es un estándar abierto desarrollado por Anthropic (creadores de Claude) para conectar asistentes de IA con fuentes de datos y herramientas externas. Permite que modelos como Claude accedan a información actualizada y puedan realizar acciones en sistemas externos de manera estandarizada.

MCP funciona como un "puente universal" para la IA, proporcionando una forma estandarizada para que los modelos accedan a distintos repositorios de contenido, servicios empresariales o aplicaciones.

## Requisitos

- Node.js v16 o superior
- Una clave de API de YouTube (obtenida desde la consola de desarrolladores de Google)

## Instalación

1. Clona este repositorio:
```bash
git clone https://github.com/Nocodeboy/youtube-mcp-server.git
cd youtube-mcp-server
```

2. Instala las dependencias:
```bash
npm install
```

3. Crea un archivo `.env` en la raíz del proyecto y añade tu clave de API de YouTube:
```
YOUTUBE_API_KEY=tu_clave_de_api_aquí
```

## Ejecución

Para iniciar el servidor, ejecuta:

```bash
npm start
```

## Integración con Claude Desktop

Para usar este servidor MCP con Claude Desktop, agrega la siguiente configuración a tu archivo `claude_desktop_config.json` (ubicado generalmente en `%APPDATA%\Claude\` en Windows o `~/Library/Application Support/Claude/` en macOS):

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["ruta/a/youtube-mcp-server/index.js"],
      "env": {
        "YOUTUBE_API_KEY": "tu_clave_de_api_aquí"
      }
    }
  }
}
```

Reemplaza `"ruta/a/youtube-mcp-server/index.js"` con la ruta absoluta al archivo `index.js`, y `"tu_clave_de_api_aquí"` con tu clave de API de YouTube.

## Herramientas disponibles

### 1. Buscar videos

Busca videos en YouTube según una consulta.

```
search_videos
```

Parámetros:
- `query` (string, requerido): Términos de búsqueda
- `maxResults` (number, opcional): Número máximo de resultados (entre 1 y 50)
- `pageToken` (string, opcional): Token para obtener la siguiente página de resultados

### 2. Obtener detalles de un video

Obtiene información detallada sobre un video específico.

```
get_video_details
```

Parámetros:
- `videoId` (string, requerido): ID del video de YouTube

### 3. Obtener detalles de un canal

Obtiene información detallada sobre un canal específico.

```
get_channel_details
```

Parámetros:
- `channelId` (string, requerido): ID del canal de YouTube

### 4. Buscar canales

Busca canales en YouTube según una consulta.

```
search_channels
```

Parámetros:
- `query` (string, requerido): Términos de búsqueda
- `maxResults` (number, opcional): Número máximo de resultados (entre 1 y 50)
- `pageToken` (string, opcional): Token para obtener la siguiente página de resultados

## Recursos disponibles

- `youtube://popular/videos`: Lista de videos populares actualmente en YouTube

## Ejemplos de uso

Con Claude Desktop, puedes hacer preguntas como:

- "Busca videos sobre programación en Python"
- "Muéstrame detalles del video con ID dQw4w9WgXcQ"
- "Busca canales relacionados con cocina"
- "Dame información sobre el canal GoogleDevelopers"
- "¿Cuáles son los videos más populares ahora mismo?"

## Obtener una clave de API de YouTube

Para obtener una clave de API de YouTube:

1. Ve a la [Consola de Desarrolladores de Google](https://console.developers.google.com/)
2. Crea un nuevo proyecto (o selecciona uno existente)
3. En el panel lateral, selecciona "Biblioteca de APIs"
4. Busca "YouTube Data API v3" y habilítala
5. En el panel lateral, selecciona "Credenciales"
6. Haz clic en "Crear credenciales" y selecciona "Clave de API"
7. Copia la clave generada y úsala en tu archivo `.env` o en la configuración de Claude Desktop

## Solución de problemas

Si encuentras errores, verifica:

1. Que has instalado todas las dependencias con `npm install`
2. Que tu clave de API de YouTube es válida
3. Que tienes la API de YouTube v3 habilitada en tu proyecto de Google
4. Que estás usando Node.js versión 16 o superior
5. Si usas Claude Desktop, verifica los logs en `%APPDATA%\Claude\logs\` (Windows) o `~/Library/Logs/Claude/` (macOS)

## Contribuciones

Las contribuciones son bienvenidas. Puedes colaborar de varias formas:

1. Reportando bugs o problemas
2. Sugeriendo nuevas funcionalidades
3. Enviando pull requests con mejoras o correcciones
4. Mejorando la documentación

## Licencia

Este proyecto está licenciado bajo la Licencia MIT. Consulta el archivo LICENSE para más detalles.