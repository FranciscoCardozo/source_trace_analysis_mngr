# source_trace_analysis_mngr

Servicio que analiza repositorios de código (Git o un `.zip`/`.tar.gz` en S3) usando un LLM local (Qwen, servido con `llama.cpp`) y deja el resultado en DynamoDB + evidencias (SVG) en S3.

No es un servidor HTTP: es un **job de batch**. Cada ejecución procesa **un paso** de un pipeline de 5, controlado enteramente por variables de entorno. En producción lo orquesta un Step Function que dispara una task de ECS Fargate por paso; localmente se corre exactamente el mismo binario, solo cambiando las env vars.

## El pipeline

Los 5 `JOB_TYPE` posibles, en orden, y qué hace cada uno:

| # | `JOB_TYPE` | Qué hace |
|---|---|---|
| 1 | `getSource` | Descarga el repo (git o S3) a `WORKDIR/<jobId>` y crea el job en Dynamo. |
| 2 | `basicAnalysis` | Valida nombre, lenguaje, framework y cuenta archivos/carpetas. |
| 3 | `functionalResume` | Le pide al modelo un resumen de 2-4 oraciones de qué hace la app. |
| 4 | `componentAnalysis` | Detecta Controllers/Services/Models/APIs consumidas y componentes propios del framework. |
| 5 | `arquitectureAnalysis` | Determina el patrón de arquitectura, genera el diagrama y limpia el `WORKDIR` del job. |

Cada paso lee de Dynamo lo que dejaron los pasos anteriores (todos comparten el mismo `PK = JOB#<jobId>`), así que **tienen que correrse en ese orden** para un mismo `jobId`.

## Requisitos

- Node.js 20+ y npm.
- Credenciales de AWS con acceso a DynamoDB y S3 (`aws configure`, SSO, o variables `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`) — el código habla directo con el SDK de AWS, no hay modo mock.
- Un modelo sirviendo `/v1/chat/completions` (formato OpenAI) solo para los pasos 2 a 5 — ver [Correr el modelo localmente](#correr-el-modelo-localmente).

## Instalación

```bash
npm install
npm run build
```

## Correr un paso en local

Cada corrida necesita, como mínimo, `JOB_ID` y `JOB_TYPE`. `getSource` además necesita `SOURCE_URL`/`SOURCE_TYPE`; los demás pasos los reutilizan de un job ya existente.

**bash:**
```bash
export JOB_ID="local-test-1"
export JOB_TYPE="getSource"
export SOURCE_URL="https://github.com/spring-projects/spring-petclinic"
export SOURCE_TYPE="git"
export WORKDIR="/tmp/source-trace"
export DYNAMODB_TABLE_NAME="source_trace_db"

node build/bin/server.js
```

**PowerShell:**
```powershell
$env:JOB_ID = "local-test-1"
$env:JOB_TYPE = "getSource"
$env:SOURCE_URL = "https://github.com/spring-projects/spring-petclinic"
$env:SOURCE_TYPE = "git"
$env:WORKDIR = "C:\temp\source-trace"
$env:DYNAMODB_TABLE_NAME = "source_trace_db"

node build/bin/server.js
```

El proceso corre ese único paso y termina solo (`process.exit(0)` en éxito, `exit(1)` en error — revisá la consola, ahí queda el log). Para encadenar el pipeline completo localmente, repetí el comando cambiando `JOB_TYPE` a `basicAnalysis`, `functionalResume`, `componentAnalysis` y `arquitectureAnalysis` en ese orden, manteniendo el mismo `JOB_ID` y el mismo `WORKDIR`.

> `arquitectureAnalysis` borra `WORKDIR/<jobId>` al terminar (limpieza normal del pipeline). Si vas a re-correr un paso anterior sobre el mismo `jobId` después de eso, va a fallar porque el código ya no está — volvé a correr `getSource` primero.

### Correr el modelo localmente

`basicAnalysis`, `functionalResume`, `componentAnalysis` y `arquitectureAnalysis` le pegan a `MODEL_SERVICE_URL` con el contrato de `/v1/chat/completions` de `llama.cpp server`. Para probarlos en local sin depender del cluster, corré el servidor oficial con cualquier `.gguf`:

```bash
docker run -p 3001:3001 -v /ruta/a/tus/modelos:/models \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/tu-modelo.gguf --host 0.0.0.0 --port 3001
```

y apuntá `MODEL_SERVICE_URL=http://localhost:3001`.

## Variables de entorno

| Variable | Requerida en | Descripción |
|---|---|---|
| `JOB_ID` | todos | Identificador del análisis; agrupa todo en Dynamo bajo `PK = JOB#<jobId>`. |
| `JOB_TYPE` | todos | Uno de los 5 pasos de la tabla de arriba. |
| `SOURCE_URL` | `getSource` | URL del repo git (`https://github.com/owner/repo`) o `s3://bucket/key`. |
| `SOURCE_TYPE` | `getSource` | `git` o `s3`. |
| `WORKDIR` | todos | Carpeta donde se descarga/lee el código fuente. Default `/tmp/source-trace`. |
| `DYNAMODB_TABLE_NAME` | todos | Tabla de Dynamo donde vive todo el estado del job. |
| `MODEL_SERVICE_URL` | pasos 2-5 | URL base del servidor de inferencia (`.../v1/chat/completions`). |
| `RESULTS_BUCKET` | pasos 4-5 | Bucket de S3 donde se suben las imágenes de evidencia y el diagrama. Si no está seteada, esos pasos siguen funcionando pero sin subir imágenes. |
| `GITHUB_TOKEN` | `getSource` (opcional) | Token para descargar repos privados de GitHub. |
| `DEBUG` | opcional | Namespaces de logging (`debug` npm). Usar `app:*` para ver todos los logs del proyecto. |

## Estructura del proyecto

```
src/
  app.ts                  # entrypoint: lee config, corre AnalysisFactory, sale con exit(0)/exit(1)
  domain/                 # lógica de negocio: factory del pipeline, repositorio de Dynamo, manejo de errores
  adapters/Impl/          # una implementación por JOB_TYPE
  ports/                  # integraciones externas: S3, git, IA, DynamoDB
ecs/                      # task definitions y service definitions de ECS
stepfunctions/            # definición del Step Function que orquesta el pipeline
.github/workflows/        # CI: build+deploy de la app y descarga del modelo a EFS
```

## Despliegue

El despliegue real corre en ECS Fargate (repo + modelo en EFS separados, resultados en S3, orquestado por el Step Function en `stepfunctions/`) y se dispara vía los workflows en `.github/workflows/`. Ver esas carpetas para el detalle de infraestructura.
